import { readFileSync, rmSync } from 'node:fs'
import { parse } from '@babel/parser'
import { discoverNewCode, findTestClaims, type ChangedLines } from './new-code'

const COVERAGE_THRESHOLD = 0.95
const CRAP_THRESHOLD = 6
const COVERAGE_DIR = 'coverage/new-code'
const LCOV_FILE = `${COVERAGE_DIR}/lcov.info`

interface FunctionMetric {
  file: string
  name: string
  start: number
  end: number
  complexity: number
  coverage: number
  crap: number
}

interface AstNode {
  type: string
  loc?: { start: { line: number }; end: { line: number } } | null
  [key: string]: unknown
}

function isStructuralLine(line: string | undefined): boolean {
  return /^[{}()[\],;.)]+$/.test(line?.trim() ?? '')
}

function verifyTestContracts(sourceLines: ChangedLines, claims: Map<string, Set<string>>): void {
  const missing: string[] = []
  for (const source of sourceLines.keys()) {
    const polarities = claims.get(source)
    for (const polarity of ['positive', 'negative']) {
      if (!polarities?.has(polarity)) missing.push(`${source}: missing ${polarity} test claim`)
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `New production code needs explicit positive and negative tests:\n${missing
        .map((message) => `  - ${message}`)
        .join('\n')}\nAdd "@new-code-test <positive|negative> <source path>" to a changed test file.`,
    )
  }
}

async function runTests(testFiles: string[]): Promise<void> {
  rmSync(COVERAGE_DIR, { recursive: true, force: true })
  const process = Bun.spawn(
    [
      'bun',
      'test',
      ...testFiles,
      '--coverage',
      '--coverage-reporter=lcov',
      `--coverage-dir=${COVERAGE_DIR}`,
    ],
    { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit', env: Bun.env },
  )
  if ((await process.exited) !== 0) throw new Error('Changed positive/negative tests failed')
}

function parseLcov(): Map<string, Map<number, number>> {
  const files = new Map<string, Map<number, number>>()
  let current: Map<number, number> | undefined
  for (const line of readFileSync(LCOV_FILE, 'utf8').split('\n')) {
    if (line.startsWith('SF:')) {
      const file = line.slice(3).replace(`${process.cwd()}/`, '')
      current = new Map()
      files.set(file, current)
    } else if (current && line.startsWith('DA:')) {
      const [lineNumber, hits] = line.slice(3).split(',').map(Number)
      if (lineNumber !== undefined && hits !== undefined) current.set(lineNumber, hits)
    }
  }
  return files
}

function isAstNode(value: unknown): value is AstNode {
  return typeof value === 'object' && value !== null && 'type' in value
}

function children(node: AstNode): AstNode[] {
  const result: AstNode[] = []
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue
    if (isAstNode(value)) result.push(value)
    else if (Array.isArray(value)) result.push(...value.filter(isAstNode))
  }
  return result
}

function isFunction(node: AstNode): boolean {
  return new Set([
    'FunctionDeclaration',
    'FunctionExpression',
    'ArrowFunctionExpression',
    'ObjectMethod',
    'ClassMethod',
    'ClassPrivateMethod',
  ]).has(node.type)
}

function functionName(node: AstNode, line: number): string {
  const id = node.id
  if (isAstNode(id) && id.type === 'Identifier' && typeof id.name === 'string') return id.name
  const key = node.key
  if (isAstNode(key) && typeof key.name === 'string') return key.name
  return `<${node.type}>@${line}`
}

function cyclomaticComplexity(root: AstNode): number {
  let complexity = 1
  function visit(node: AstNode): void {
    if (node !== root && isFunction(node)) return
    if (
      new Set([
        'IfStatement',
        'ForStatement',
        'ForInStatement',
        'ForOfStatement',
        'WhileStatement',
        'DoWhileStatement',
        'CatchClause',
        'ConditionalExpression',
      ]).has(node.type) ||
      (node.type === 'SwitchCase' && node.test !== null)
    ) {
      complexity += 1
    } else if (node.type === 'LogicalExpression' && ['&&', '||', '??'].includes(String(node.operator))) {
      complexity += 1
    }
    for (const child of children(node)) visit(child)
  }
  visit(root)
  return complexity
}

function functionMetrics(
  sourceLines: ChangedLines,
  coverage: Map<string, Map<number, number>>,
): FunctionMetric[] {
  const metrics: FunctionMetric[] = []
  for (const [file, changedLines] of sourceLines) {
    const sourceText = readFileSync(file, 'utf8')
    const sourceRows = sourceText.split('\n')
    const source = parse(sourceText, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    }) as unknown as AstNode
    const candidates: FunctionMetric[] = []
    function visit(node: AstNode): void {
      if (isFunction(node) && node.loc) {
        const start = node.loc.start.line
        const end = node.loc.end.line
        if ([...changedLines].some((line) => line >= start && line <= end)) {
          const executable = [...(coverage.get(file) ?? new Map())].filter(
            ([line]) => line >= start && line <= end && !isStructuralLine(sourceRows[line - 1]),
          )
          const covered = executable.filter(([, hits]) => hits > 0).length
          const lineCoverage = executable.length === 0 ? 0 : covered / executable.length
          const complexity = cyclomaticComplexity(node)
          candidates.push({
            file,
            name: functionName(node, start),
            start,
            end,
            complexity,
            coverage: lineCoverage,
            crap: complexity ** 2 * (1 - lineCoverage) ** 3 + complexity,
          })
        }
      }
      for (const child of children(node)) visit(child)
    }
    visit(source)

    // Attribute a changed line to its narrowest containing function. This avoids
    // charging a route callback's coverage to the large plugin factory around it.
    for (const candidate of candidates) {
      const ownsChangedLine = [...changedLines].some(
        (line) =>
          line >= candidate.start &&
          line <= candidate.end &&
          !candidates.some(
            (other) =>
              other !== candidate &&
              other.start >= candidate.start &&
              other.end <= candidate.end &&
              line >= other.start &&
              line <= other.end,
          ),
      )
      if (ownsChangedLine) metrics.push(candidate)
    }
  }
  return metrics
}

function verifyCoverage(
  sourceLines: ChangedLines,
  coverage: Map<string, Map<number, number>>,
): void {
  let executable = 0
  let covered = 0
  const uncovered: string[] = []
  for (const [file, changedLines] of sourceLines) {
    const fileCoverage = coverage.get(file)
    if (!fileCoverage) throw new Error(`No coverage record was produced for changed file ${file}`)
    const source = readFileSync(file, 'utf8').split('\n')
    for (const line of changedLines) {
      const hits = fileCoverage.get(line)
      if (hits === undefined) continue
      // Bun's LCOV currently emits zero-hit entries for some closing braces.
      // Structural-only lines are not executable new code and must not dilute
      // diff coverage.
      if (isStructuralLine(source[line - 1])) continue
      executable += 1
      if (hits > 0) covered += 1
      else uncovered.push(`${file}:${line}`)
    }
  }
  if (executable === 0) throw new Error('No executable changed lines were found in the coverage report')
  const score = covered / executable
  console.log(
    `[new-code] diff coverage ${(score * 100).toFixed(2)}% (${covered}/${executable} executable lines)`,
  )
  if (score < COVERAGE_THRESHOLD) {
    throw new Error(
      `New-code coverage must be at least 95%. Uncovered: ${uncovered.slice(0, 20).join(', ')}`,
    )
  }
}

async function main(): Promise<void> {
  const change = discoverNewCode()
  if (change.sourceLines.size === 0) {
    console.log(`[new-code] no changed production code relative to ${change.base}; gate skipped`)
    return
  }
  console.log(
    `[new-code] base ${change.base}; ${change.sourceLines.size} source file(s), ${change.testFiles.length} changed test file(s)`,
  )
  const testClaims = findTestClaims(change.sourceLines, change.testFiles)
  verifyTestContracts(change.sourceLines, testClaims.claims)
  await runTests(testClaims.testFiles)
  const coverage = parseLcov()
  verifyCoverage(change.sourceLines, coverage)

  const metrics = functionMetrics(change.sourceLines, coverage)
  for (const metric of metrics) {
    console.log(
      `[new-code] CRAP ${metric.crap.toFixed(2)} ${metric.file}:${metric.start} ${metric.name} ` +
        `(complexity ${metric.complexity}, coverage ${(metric.coverage * 100).toFixed(2)}%)`,
    )
  }
  const failures = metrics.filter((metric) => metric.crap > CRAP_THRESHOLD)
  if (failures.length > 0) {
    throw new Error(
      `Changed functions must have CRAP <= ${CRAP_THRESHOLD}: ${failures
        .map((metric) => `${metric.file}:${metric.start} ${metric.name}=${metric.crap.toFixed(2)}`)
        .join(', ')}`,
    )
  }
  console.log('[new-code] coverage, CRAP, and positive/negative test gates passed')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
