import { describe, expect, it } from 'bun:test'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { auditTestFoundation } from './audit'
import { gateInfrastructure, RequiredInfrastructureError } from './infrastructure'
import { createTestNamespace } from './namespace'
import { moduleDirectory, stderrFixtureCommand } from './portable-process'
import { reserveLoopbackPort } from './ports'
import { classifyTestFile, loadTestTaxonomy, parseTestTaxonomy } from './taxonomy'

describe('test harness port isolation', () => {
  it('reserves unique OS-assigned ports in parallel and releases idempotently', async () => {
    const reservations = await Promise.all(Array.from({ length: 6 }, () => reserveLoopbackPort()))
    expect(new Set(reservations.map(({ port }) => port)).size).toBe(6)
    expect(reservations.every(({ origin }) => origin.startsWith('http://127.0.0.1:'))).toBe(true)

    await Promise.all(reservations.map((reservation) => reservation.release()))
    await Promise.all(reservations.map((reservation) => reservation.release()))
    expect(reservations.every(({ released }) => released)).toBe(true)

    const rebound = createServer()
    await new Promise<void>((resolveListen, reject) => {
      rebound.once('error', reject)
      rebound.listen({ host: '127.0.0.1', port: reservations[0]?.port }, resolveListen)
    })
    await new Promise<void>((resolveClose) => rebound.close(() => resolveClose()))
  })
})

describe('test harness resource namespaces', () => {
  it('is deterministic for explicit run/suite/worker inputs', () => {
    const first = createTestNamespace({ runId: 'build-42', suiteId: 'storage', workerId: 3 })
    const second = createTestNamespace({ runId: 'build-42', suiteId: 'storage', workerId: 3 })

    expect(first.postgresSchema('objects')).toBe(second.postgresSchema('objects'))
    expect(first.storageBucket('objects')).toBe(second.storageBucket('objects'))
    expect(first.tempPath('objects')).toBe(second.tempPath('objects'))
  })

  it('separates workers and emits provider-safe names', () => {
    const first = createTestNamespace({
      runId: 'PR #123',
      suiteId: 'Long Storage Suite',
      workerId: 1,
    })
    const second = createTestNamespace({
      runId: 'PR #123',
      suiteId: 'Long Storage Suite',
      workerId: 2,
    })

    expect(first.postgresDatabase()).not.toBe(second.postgresDatabase())
    expect(first.postgresDatabase()).toMatch(/^[a-z0-9_]+$/)
    expect(first.postgresDatabase().length).toBeLessThanOrEqual(63)
    expect(first.storageBucket()).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/)
    expect(first.storageBucket().length).toBeLessThanOrEqual(63)
  })
})

describe('test harness infrastructure policy', () => {
  const requirement = [{ name: 'TEST_POSTGRES_URL', kind: 'postgres-url' }] as const

  it('fails on missing required infrastructure by default without leaking values', () => {
    expect(() =>
      gateInfrastructure({
        suiteId: 'postgres-contract',
        requirements: requirement,
        environment: {},
      }),
    ).toThrow(RequiredInfrastructureError)
  })

  it('requires an explicit reason before returning a skip', () => {
    expect(() =>
      gateInfrastructure({
        suiteId: 'optional-local-probe',
        requirements: requirement,
        environment: {},
        onMissing: 'skip',
      }),
    ).toThrow('skipReason')

    expect(
      gateInfrastructure({
        suiteId: 'optional-local-probe',
        requirements: requirement,
        environment: {},
        onMissing: 'skip',
        skipReason: 'developer opted out of the local PostgreSQL probe',
      }),
    ).toEqual({
      action: 'skip',
      reason: 'developer opted out of the local PostgreSQL probe (TEST_POSTGRES_URL)',
      missing: ['TEST_POSTGRES_URL'],
      invalid: [],
    })
  })

  it('rejects malformed URLs and returns validated values', () => {
    expect(() =>
      gateInfrastructure({
        suiteId: 'postgres-contract',
        requirements: requirement,
        environment: { TEST_POSTGRES_URL: 'http://not-postgres.example' },
      }),
    ).toThrow(RequiredInfrastructureError)

    expect(
      gateInfrastructure({
        suiteId: 'postgres-contract',
        requirements: requirement,
        environment: { TEST_POSTGRES_URL: 'postgresql://test.invalid/sinope' },
      }),
    ).toEqual({
      action: 'run',
      values: { TEST_POSTGRES_URL: 'postgresql://test.invalid/sinope' },
    })
  })
})

describe('test harness Windows portability', () => {
  it('captures stderr without a platform shell', async () => {
    const fixture = stderrFixtureCommand('portable stderr', 7)
    const proc = Bun.spawn([fixture.command, ...fixture.args], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited])

    expect(exitCode).toBe(7)
    expect(stderr).toBe('portable stderr')
  })

  it('converts file URLs with platform-native semantics', () => {
    expect(moduleDirectory(import.meta.url)).toBe(import.meta.dir)
  })
})

describe('test suite taxonomy', () => {
  const root = resolve(import.meta.dir, '../..')

  it('loads the release taxonomy and assigns representative files once', async () => {
    const taxonomy = await loadTestTaxonomy(resolve(root, 'wave0-test-taxonomy.json'))
    expect(classifyTestFile(taxonomy, 'src/tools/store/store.test.ts').map(({ id }) => id)).toEqual(
      ['unit'],
    )
    expect(
      classifyTestFile(taxonomy, 'tests/integration/pb-api-record.test.ts').map(({ id }) => id),
    ).toEqual(['component'])
    expect(
      classifyTestFile(taxonomy, 'tests/integration/storage.test.ts').map(({ id }) => id),
    ).toEqual(['storage-contract'])
    expect(
      classifyTestFile(taxonomy, 'src/core/db-postgres-rls.test.ts').map(({ id }) => id),
    ).toEqual(['postgres-rls-contract'])
  })

  it('rejects release suites that skip infrastructure or allow fallback', () => {
    const invalid = {
      schemaVersion: 1,
      testRunIdEnvironment: 'TEST_RUN_ID',
      suites: [
        {
          id: 'bad-release-suite',
          kind: 'integration',
          releaseRequired: true,
          include: ['tests/**/*.test.ts'],
          infrastructure: ['TEST_POSTGRES_URL'],
          onMissingInfrastructure: 'skip',
          fallbackPolicy: 'allow',
          isolation: {
            process: 'per-file',
            port: 'dynamic',
            namespace: 'per-suite',
            filesystem: 'temp-per-suite',
          },
        },
      ],
    }
    expect(() => parseTestTaxonomy(invalid)).toThrow('must fail')
  })

  it('classifies every test once and keeps the hazard inventory current', async () => {
    const audit = await auditTestFoundation(root)
    expect(audit.unclassified).toEqual([])
    expect(audit.multiplyClassified).toEqual([])
    expect(audit.unreviewedHazards).toEqual([])
    expect(audit.staleReviewedHazards).toEqual([])
  })
})
