export type SuiteKind = 'unit' | 'component' | 'contract' | 'integration' | 'e2e'

export interface TestSuiteDefinition {
  id: string
  kind: SuiteKind
  releaseRequired: boolean
  include: string[]
  exclude?: string[]
  infrastructure: string[]
  onMissingInfrastructure: 'fail' | 'skip'
  fallbackPolicy: 'forbid' | 'allow'
  isolation: {
    process: 'shared' | 'per-file'
    port: 'none' | 'dynamic'
    namespace: 'none' | 'per-suite' | 'per-test'
    filesystem: 'none' | 'temp-per-suite' | 'temp-per-test'
  }
}

export interface TestTaxonomy {
  schemaVersion: 1
  testRunIdEnvironment: string
  suites: TestSuiteDefinition[]
}

const SUITE_KINDS = new Set<SuiteKind>(['unit', 'component', 'contract', 'integration', 'e2e'])
const PROCESS_ISOLATION = new Set(['shared', 'per-file'])
const PORT_ISOLATION = new Set(['none', 'dynamic'])
const NAMESPACE_ISOLATION = new Set(['none', 'per-suite', 'per-test'])
const FILESYSTEM_ISOLATION = new Set(['none', 'temp-per-suite', 'temp-per-test'])

function assertStringArray(value: unknown, field: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${field} must be an array of non-empty strings`)
  }
}

export function parseTestTaxonomy(value: unknown): TestTaxonomy {
  if (!value || typeof value !== 'object') throw new Error('taxonomy must be an object')
  const taxonomy = value as Partial<TestTaxonomy>
  if (taxonomy.schemaVersion !== 1) throw new Error('taxonomy.schemaVersion must be 1')
  if (typeof taxonomy.testRunIdEnvironment !== 'string' || !taxonomy.testRunIdEnvironment.trim()) {
    throw new Error('taxonomy.testRunIdEnvironment must be a non-empty string')
  }
  if (!Array.isArray(taxonomy.suites) || taxonomy.suites.length === 0) {
    throw new Error('taxonomy.suites must contain at least one suite')
  }

  const ids = new Set<string>()
  for (const suite of taxonomy.suites) {
    if (!suite.id?.trim()) throw new Error('every suite requires an id')
    if (ids.has(suite.id)) throw new Error(`duplicate suite id: ${suite.id}`)
    ids.add(suite.id)
    if (!SUITE_KINDS.has(suite.kind)) throw new Error(`suite ${suite.id} has an invalid kind`)
    if (typeof suite.releaseRequired !== 'boolean') {
      throw new Error(`suite ${suite.id}.releaseRequired must be boolean`)
    }
    assertStringArray(suite.include, `suite ${suite.id}.include`)
    if (suite.exclude) assertStringArray(suite.exclude, `suite ${suite.id}.exclude`)
    assertStringArray(suite.infrastructure, `suite ${suite.id}.infrastructure`)
    if (!['fail', 'skip'].includes(suite.onMissingInfrastructure)) {
      throw new Error(`suite ${suite.id} has an invalid missing-infrastructure policy`)
    }
    if (!['forbid', 'allow'].includes(suite.fallbackPolicy)) {
      throw new Error(`suite ${suite.id} has an invalid fallback policy`)
    }
    if (!suite.isolation || typeof suite.isolation !== 'object') {
      throw new Error(`suite ${suite.id} requires isolation settings`)
    }
    if (!PROCESS_ISOLATION.has(suite.isolation.process)
      || !PORT_ISOLATION.has(suite.isolation.port)
      || !NAMESPACE_ISOLATION.has(suite.isolation.namespace)
      || !FILESYSTEM_ISOLATION.has(suite.isolation.filesystem)) {
      throw new Error(`suite ${suite.id} has invalid isolation settings`)
    }

    if (suite.releaseRequired && suite.onMissingInfrastructure !== 'fail') {
      throw new Error(`release-required suite ${suite.id} must fail when infrastructure is missing`)
    }
    if (suite.releaseRequired && suite.fallbackPolicy !== 'forbid') {
      throw new Error(`release-required suite ${suite.id} must forbid fallbacks`)
    }
    if (suite.isolation.port === 'dynamic' && suite.isolation.process !== 'per-file') {
      throw new Error(`suite ${suite.id} with dynamic ports must use per-file process isolation`)
    }
  }

  return taxonomy as TestTaxonomy
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '')
}

function matchesAny(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => new Bun.Glob(pattern).match(path))
}

export function classifyTestFile(taxonomy: TestTaxonomy, file: string): TestSuiteDefinition[] {
  const normalized = normalizePath(file)
  return taxonomy.suites.filter((suite) => (
    matchesAny(normalized, suite.include)
    && !matchesAny(normalized, suite.exclude ?? [])
  ))
}

export async function loadTestTaxonomy(path: string): Promise<TestTaxonomy> {
  const parsed = JSON.parse(await Bun.file(path).text()) as unknown
  return parseTestTaxonomy(parsed)
}
