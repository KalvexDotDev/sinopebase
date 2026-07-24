import { createHash, randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const POSTGRES_IDENTIFIER_LIMIT = 63
const STORAGE_BUCKET_LIMIT = 63

export interface TestNamespaceOptions {
  runId?: string
  suiteId: string
  workerId?: string | number
}

export interface TestNamespace {
  readonly runId: string
  readonly suiteId: string
  readonly workerId: string
  resourceName(label: string): string
  postgresDatabase(label?: string): string
  postgresSchema(label?: string): string
  storageBucket(label?: string): string
  tempPath(...parts: string[]): string
}

function compactHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 10)
}

function sanitize(value: string, separator: '_' | '-'): string {
  const sanitized = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`^\\${separator}+|\\${separator}+$`, 'g'), '')

  return sanitized || 'test'
}

function limitIdentifier(value: string, limit: number, separator: '_' | '-'): string {
  if (value.length <= limit) return value
  const suffix = compactHash(value)
  return `${value.slice(0, limit - suffix.length - 1)}${separator}${suffix}`
}

function createRunId(): string {
  const configured = process.env['SINOPEBASE_TEST_RUN_ID']?.trim()
  if (configured) return configured
  return `${process.pid}-${randomUUID()}`
}

/**
 * Generates names unique to a test run, suite and worker. CI should set
 * SINOPEBASE_TEST_RUN_ID to a stable job identifier for reproducible evidence.
 */
export function createTestNamespace(options: TestNamespaceOptions): TestNamespace {
  const runId = options.runId?.trim() || createRunId()
  const suiteId = options.suiteId.trim()
  const workerId = String(options.workerId ?? process.env['BUN_TEST_WORKER_ID'] ?? '0').trim()

  if (!suiteId) throw new Error('suiteId must not be empty')

  const rawPrefix = `${runId}_${suiteId}_${workerId}`
  const postgresPrefix = sanitize(`sb_${rawPrefix}`, '_')
  const storagePrefix = sanitize(`sb-${rawPrefix}`, '-')
  const filesystemPrefix = limitIdentifier(sanitize(`sb-${rawPrefix}`, '-'), 100, '-')

  const resourceName = (label: string): string => {
    const raw = `${postgresPrefix}_${sanitize(label, '_')}`
    return limitIdentifier(raw, POSTGRES_IDENTIFIER_LIMIT, '_')
  }

  return {
    runId,
    suiteId,
    workerId,
    resourceName,
    postgresDatabase: (label = 'db') => resourceName(label),
    postgresSchema: (label = 'schema') => resourceName(label),
    storageBucket: (label = 'bucket') => {
      const raw = `${storagePrefix}-${sanitize(label, '-')}`
      return limitIdentifier(raw, STORAGE_BUCKET_LIMIT, '-')
    },
    tempPath: (...parts: string[]) => {
      const safeParts = parts.map((part) => sanitize(part, '-'))
      return resolve(join(tmpdir(), 'sinopebase-tests', filesystemPrefix, ...safeParts))
    },
  }
}
