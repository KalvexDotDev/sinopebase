import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

export type TestHazardKind =
  | 'ambient-infrastructure'
  | 'credential-fallback'
  | 'fixed-server-port'
  | 'infrastructure-skip'
  | 'portable-shell'
  | 'runtime-fallback'
  | 'shared-filesystem-fixture'

export interface TestHazard {
  kind: TestHazardKind
  file: string
  line: number
  detail: string
}

const IGNORED_DIRECTORIES = new Set([
  '.git', '.claude', '.memento-staging', 'dist', 'node_modules', 'pb_data', 'tests/harness',
])

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/')
}

async function sourceFiles(root: string, directory = root): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name)
    const relativePath = normalizePath(relative(root, absolute))
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(relativePath) && !IGNORED_DIRECTORIES.has(entry.name)) {
        files.push(...await sourceFiles(root, absolute))
      }
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(absolute)
    }
  }
  return files
}

function testHazards(file: string, source: string): TestHazard[] {
  const hazards: TestHazard[] = []
  const isTest = file.endsWith('.test.ts')
  const startsServer = source.includes('new Sinopebase') && /\.start\s*\(\s*\)/.test(source)

  for (const [index, line] of source.split(/\r?\n/).entries()) {
    const lineNumber = index + 1
    const add = (kind: TestHazardKind, detail: string): void => {
      hazards.push({ kind, file, line: lineNumber, detail })
    }

    if (isTest && /\b(?:describe|it|test)\.skip\b|\b(?:xdescribe|xit)\s*\(/.test(line)) {
      add('infrastructure-skip', 'test skip is selected from ambient state')
    }
    if (isTest && startsServer) {
      const fixedPort = line.match(/(?:\bport\s*:|\bconst\s+\w*[Pp]ort\s*=)\s*(\d{2,5})\b/)
      if (fixedPort) add('fixed-server-port', `literal port ${fixedPort[1]}`)
    }
    if (isTest) {
      const ambient: string[] = []
      if (/postgresUrl\s*:\s*(?:process\.env\.[A-Z0-9_]+\s*\|\|\s*)?['"]['"]/.test(line)) {
        ambient.push('PostgreSQL can fall through to ambient POSTGRES_URL or memory')
      }
      if (/minio(?:Endpoint|AccessKey|SecretKey)\s*:\s*['"]['"]/.test(line)) {
        ambient.push('object storage can fall through to ambient RUSTFS settings or local storage')
      }
      if (ambient.length > 0) add('ambient-infrastructure', ambient.join('; '))
    }
    if (file.startsWith('tests/') && /SINOPEBASE_(?:ANON|SERVICE_ROLE)_KEY[^?]*\?\?\s*['"]test-/.test(line)) {
      add('credential-fallback', 'test credential silently falls back to a hard-coded key')
    }
    if (isTest && /TEST_FUNCTIONS_DIR\s*=\s*resolve/.test(line)) {
      add('shared-filesystem-fixture', 'suite uses a repository-relative shared fixture directory')
    }
    if (isTest && /(?:TEST_BUCKET\s*=|TODOS_SCHEMA\s*=)/.test(line)) {
      add('shared-filesystem-fixture', 'hardcoded fixture name causes cross-suite contamination')
    }
    if (isTest && /RunCommand\(['"]bash['"]/.test(line)) {
      add('portable-shell', 'test assumes a POSIX bash executable and shell syntax')
    }
    if (isTest && /:\/\/127\.0\.0\.1:8090/.test(line)) {
      add('fixed-server-port', 'hardcoded port 8090 in test URL fallback')
    }
    if (file === 'src/core/app.ts' && /falling back to in-memory|new MemoryDatabase(?:Adapter)?\(|new LocalFileStore\(/.test(line)) {
      add('runtime-fallback', 'runtime silently substitutes non-production infrastructure')
    }
  }

  return hazards
}

export async function scanTestHazards(root: string): Promise<TestHazard[]> {
  const hazards: TestHazard[] = []
  for (const absolute of await sourceFiles(root)) {
    const file = normalizePath(relative(root, absolute))
    hazards.push(...testHazards(file, await readFile(absolute, 'utf8')))
  }
  return hazards.sort((a, b) => (
    a.file.localeCompare(b.file) || a.line - b.line || a.kind.localeCompare(b.kind)
  ))
}

export function hazardKey(hazard: Pick<TestHazard, 'kind' | 'file' | 'line'>): string {
  return `${hazard.kind}:${normalizePath(hazard.file)}:${hazard.line}`
}
