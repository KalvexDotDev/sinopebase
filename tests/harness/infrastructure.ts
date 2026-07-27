export type MissingInfrastructurePolicy = 'fail' | 'skip'
export type EnvironmentValueKind = 'non-empty' | 'url' | 'postgres-url'

export interface EnvironmentRequirement {
  name: string
  kind?: EnvironmentValueKind
  secret?: boolean
}

export interface InfrastructureGateOptions {
  suiteId: string
  requirements: readonly EnvironmentRequirement[]
  onMissing?: MissingInfrastructurePolicy
  environment?: Record<string, string | undefined>
  skipReason?: string
}

export interface InfrastructureReady {
  action: 'run'
  values: Readonly<Record<string, string>>
}

export interface InfrastructureSkipped {
  action: 'skip'
  reason: string
  missing: readonly string[]
  invalid: readonly string[]
}

export type InfrastructureGate = InfrastructureReady | InfrastructureSkipped

export class RequiredInfrastructureError extends Error {
  readonly suiteId: string
  readonly missing: readonly string[]
  readonly invalid: readonly string[]

  constructor(suiteId: string, missing: readonly string[], invalid: readonly string[]) {
    const problems = [
      missing.length > 0 ? `missing: ${missing.join(', ')}` : '',
      invalid.length > 0 ? `invalid: ${invalid.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('; ')
    super(`Required infrastructure for suite "${suiteId}" is unavailable (${problems})`)
    this.name = 'RequiredInfrastructureError'
    this.suiteId = suiteId
    this.missing = missing
    this.invalid = invalid
  }
}

function isValid(value: string, kind: EnvironmentValueKind): boolean {
  if (kind === 'non-empty') return value.length > 0

  try {
    const parsed = new URL(value)
    if (kind === 'postgres-url') {
      return parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:'
    }
    return Boolean(parsed.protocol && parsed.hostname)
  } catch {
    return false
  }
}

/**
 * Resolve a suite's infrastructure explicitly. Missing infrastructure fails by
 * default. A skip is returned only when the suite opts into onMissing: "skip"
 * and provides a visible reason; no adapter fallback is selected here.
 */
export function gateInfrastructure(options: InfrastructureGateOptions): InfrastructureGate {
  const environment = options.environment ?? process.env
  const values: Record<string, string> = {}
  const missing: string[] = []
  const invalid: string[] = []

  for (const requirement of options.requirements) {
    const value = environment[requirement.name]?.trim() ?? ''
    if (!value) {
      missing.push(requirement.name)
      continue
    }
    if (!isValid(value, requirement.kind ?? 'non-empty')) {
      invalid.push(requirement.name)
      continue
    }
    values[requirement.name] = value
  }

  if (missing.length === 0 && invalid.length === 0) {
    return { action: 'run', values }
  }

  if ((options.onMissing ?? 'fail') === 'fail') {
    throw new RequiredInfrastructureError(options.suiteId, missing, invalid)
  }

  const skipReason = options.skipReason?.trim()
  if (!skipReason) {
    throw new Error(`Suite "${options.suiteId}" must provide skipReason when onMissing is "skip"`)
  }

  return {
    action: 'skip',
    reason: `${skipReason} (${[...missing, ...invalid].join(', ')})`,
    missing,
    invalid,
  }
}

export const POSTGRES_REQUIREMENTS = [
  { name: 'TEST_POSTGRES_URL', kind: 'postgres-url', secret: true },
] as const satisfies readonly EnvironmentRequirement[]

export const AUTH_KEY_REQUIREMENTS = [
  { name: 'SINOPEBASE_ANON_KEY', secret: true },
  { name: 'SINOPEBASE_SERVICE_ROLE_KEY', secret: true },
] as const satisfies readonly EnvironmentRequirement[]

export const OBJECT_STORAGE_REQUIREMENTS = [
  { name: 'RUSTFS_ENDPOINT', kind: 'url' },
  { name: 'RUSTFS_ACCESS_KEY', secret: true },
  { name: 'RUSTFS_SECRET_KEY', secret: true },
] as const satisfies readonly EnvironmentRequirement[]
