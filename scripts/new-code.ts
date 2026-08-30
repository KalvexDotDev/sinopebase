import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

export type ChangedLines = Map<string, Set<number>>

export interface NewCodeChange {
  base: string
  sourceLines: ChangedLines
  testFiles: string[]
}

export interface TestClaims {
  claims: Map<string, Set<string>>
  testFiles: string[]
}

const SOURCE_FILE = /^src\/.*\.[cm]?[jt]sx?$/
const TEST_FILE = /(?:^|\/)[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$/

function git(args: string[], allowFailure = false): string {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (error) {
    if (allowFailure) return ''
    throw error
  }
}

function isCommit(ref: string): boolean {
  return git(['cat-file', '-e', `${ref}^{commit}`], true) === ''
    ? git(['rev-parse', '--verify', `${ref}^{commit}`], true).length > 0
    : true
}

export function resolveNewCodeBase(): string {
  const candidates = [
    process.env.NEW_CODE_BASE,
    process.env.GITHUB_BASE_SHA,
    process.env.GITHUB_EVENT_BEFORE,
    process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : undefined,
  ].filter((candidate): candidate is string => Boolean(candidate && !/^0+$/.test(candidate)))

  for (const candidate of candidates) {
    if (isCommit(candidate)) return candidate
  }

  // Local runs validate the working tree. CI always supplies NEW_CODE_BASE.
  if (process.env.GITHUB_ACTIONS !== 'true' && isCommit('HEAD')) return 'HEAD'
  if (isCommit('HEAD^')) return 'HEAD^'
  throw new Error('Cannot resolve the base revision; set NEW_CODE_BASE to a commit SHA')
}

function isProductionSource(path: string): boolean {
  return SOURCE_FILE.test(path) && !TEST_FILE.test(path) && !path.endsWith('.d.ts')
}

function isTest(path: string): boolean {
  return TEST_FILE.test(path) && (path.startsWith('src/') || path.startsWith('tests/'))
}

function addLine(changes: ChangedLines, file: string, line: number): void {
  const lines = changes.get(file) ?? new Set<number>()
  lines.add(line)
  changes.set(file, lines)
}

function parseDiff(diff: string): { sourceLines: ChangedLines; changedFiles: Set<string> } {
  const sourceLines: ChangedLines = new Map()
  const changedFiles = new Set<string>()
  let file = ''
  let newLine = 0

  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      file = line.slice(6)
      changedFiles.add(file)
      continue
    }
    if (line.startsWith('+++ /dev/null')) {
      file = ''
      continue
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunk) {
      newLine = Number(hunk[1])
      continue
    }
    if (!file || line.startsWith('diff --git') || line.startsWith('--- ')) continue
    if (line.startsWith('+')) {
      if (isProductionSource(file)) addLine(sourceLines, file, newLine)
      newLine += 1
    } else if (!line.startsWith('-')) {
      newLine += 1
    }
  }

  return { sourceLines, changedFiles }
}

function addUntrackedFiles(sourceLines: ChangedLines, changedFiles: Set<string>): void {
  const untracked = git(['ls-files', '--others', '--exclude-standard'])
  if (!untracked) return
  for (const file of untracked.split('\n')) {
    changedFiles.add(file)
    if (!isProductionSource(file)) continue
    const lineCount = readFileSync(file, 'utf8').split('\n').length
    for (let line = 1; line <= lineCount; line += 1) addLine(sourceLines, file, line)
  }
}

export function discoverNewCode(): NewCodeChange {
  const base = resolveNewCodeBase()
  const diff = git([
    'diff',
    '--unified=0',
    '--no-color',
    '--diff-filter=AMR',
    base,
    '--',
    'src',
    'tests',
  ])
  const { sourceLines, changedFiles } = parseDiff(diff)
  addUntrackedFiles(sourceLines, changedFiles)
  return {
    base,
    sourceLines,
    testFiles: [...changedFiles].filter(isTest).sort(),
  }
}

export function findTestClaims(sourceLines: ChangedLines, testFiles: string[]): TestClaims {
  const claims = new Map<string, Set<string>>()
  const relevantTests = new Set<string>()
  const annotation = /@new-code-test\s+(positive|negative)\s+(src\/\S+)/g
  for (const testFile of testFiles) {
    const contents = readFileSync(testFile, 'utf8')
    for (const match of contents.matchAll(annotation)) {
      const polarity = match[1]
      const source = match[2]
      if (!polarity || !source || !sourceLines.has(source)) continue
      const polarities = claims.get(source) ?? new Set<string>()
      polarities.add(polarity)
      claims.set(source, polarities)
      relevantTests.add(testFile)
    }
  }
  return { claims, testFiles: [...relevantTests].sort() }
}

export function lineRanges(sourceLines: ChangedLines): string[] {
  const targets: string[] = []
  for (const [file, lines] of sourceLines) {
    const sorted = [...lines].sort((left, right) => left - right)
    let start = sorted[0]
    let end = start
    for (const line of sorted.slice(1)) {
      if (end !== undefined && line === end + 1) {
        end = line
        continue
      }
      if (start !== undefined && end !== undefined) targets.push(`${file}:${start}-${end}`)
      start = line
      end = line
    }
    if (start !== undefined && end !== undefined) targets.push(`${file}:${start}-${end}`)
  }
  return targets
}
