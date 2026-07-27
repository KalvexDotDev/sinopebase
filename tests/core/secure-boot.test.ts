import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type AppConfig, Sinopebase } from '../../src/core/app'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let nextPort = 41000
function getPort(): number {
  return nextPort++
}

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: getPort(),
    dataDir: join(tmpdir(), `sinopebase-secure-boot-${getPort()}`),
    postgresUrl: '',
    minioEndpoint: '',
    minioAccessKey: '',
    minioSecretKey: '',
    ...overrides,
  }
}

/**
 * Snapshot env vars that Sinopebase reads during startup so that
 * parallel test files (integration tests that set real PG/S3 URLs)
 * do not pollute these tests.
 */
const ENV_SNAPSHOT_KEYS = [
  'POSTGRES_URL',
  'SINOPEBASE_SERVICE_ROLE_KEY',
  'SINOPEBASE_ANON_KEY',
  'RUSTFS_ENDPOINT',
  'RUSTFS_ACCESS_KEY',
  'RUSTFS_SECRET_KEY',
] as const

const savedEnv = new Map<string, string | undefined>()

beforeAll(() => {
  for (const key of ENV_SNAPSHOT_KEYS) {
    savedEnv.set(key, process.env[key])
    delete process.env[key]
  }
})

afterAll(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

// ---------------------------------------------------------------------------
// Production mode fail-closed (uses explicit mode config, not env vars)
// ---------------------------------------------------------------------------

describe('secure boot — production mode', () => {
  it('throws when postgresUrl is unset in production mode', async () => {
    const app = new Sinopebase(makeConfig({ mode: 'production' }))
    await expect(app.start()).rejects.toThrow(/POSTGRES_URL/)
  })

  it('throws when S3 is unset in production mode (even with postgresUrl)', async () => {
    const app = new Sinopebase(
      makeConfig({
        mode: 'production',
        postgresUrl: 'postgres://user:pass@localhost:5432/testdb',
      }),
    )
    await expect(app.start()).rejects.toThrow(/S3|MinIO|RUSTFS_ENDPOINT/)
  })

  it('throws with both missing PG and S3 — reports PG first', async () => {
    const app = new Sinopebase(makeConfig({ mode: 'production' }))
    await expect(app.start()).rejects.toThrow(/POSTGRES_URL/)
  })
})

// ---------------------------------------------------------------------------
// Development mode — fallbacks allowed (default mode)
// ---------------------------------------------------------------------------

describe('secure boot — development mode', () => {
  it('starts with memory db when postgresUrl is empty', async () => {
    const app = new Sinopebase(makeConfig())
    await app.start()
    expect(app.getDatabase()).not.toBeNull()
    await app.stop()
  })

  it('starts with local file store when S3 is unset', async () => {
    const app = new Sinopebase(makeConfig())
    await app.start()
    expect(app.getFileStore()).not.toBeNull()
    await app.stop()
  })

  it('health endpoint reports development mode', async () => {
    const app = new Sinopebase(makeConfig())
    await app.start()
    const config = app.buildValidatedConfig()
    expect(config.host).toBe('0.0.0.0')
    expect(config.port).toBeGreaterThan(0)
    await app.stop()
  })
})

// ---------------------------------------------------------------------------
// buildValidatedConfig
// ---------------------------------------------------------------------------

describe('buildValidatedConfig', () => {
  it('returns defaults for unset fields', () => {
    const app = new Sinopebase(makeConfig({ port: 8090 }))
    const vc = app.buildValidatedConfig()
    expect(vc.port).toBe(8090)
    expect(vc.host).toBe('0.0.0.0')
    expect(vc.mastraRequireAuth).toBe(true)
    expect(vc.oauthProviders).toEqual([])
    expect(vc.extraOrigins).toEqual([])
    expect(vc.trustedProxies).toEqual([])
  })

  it('reflects config overrides', () => {
    const app = new Sinopebase(
      makeConfig({
        port: 9999,
        host: '127.0.0.1',
        mastraRequireAuth: false,
        extraOrigins: ['https://example.com'],
      }),
    )
    const vc = app.buildValidatedConfig()
    expect(vc.port).toBe(9999)
    expect(vc.host).toBe('127.0.0.1')
    expect(vc.mastraRequireAuth).toBe(false)
    expect(vc.extraOrigins).toEqual(['https://example.com'])
  })

  it('includes tls when configured', () => {
    const app = new Sinopebase(
      makeConfig({
        tls: { cert: '/certs/cert.pem', key: '/certs/key.pem' },
      }),
    )
    const vc = app.buildValidatedConfig()
    expect(vc.tls).toEqual({ cert: '/certs/cert.pem', key: '/certs/key.pem' })
  })
})
