import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type AppConfig, Sinopebase } from '../../src/core/app'
import { reserveLoopbackPort } from '../harness'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function startTestApp(overrides: Partial<AppConfig> = {}): Promise<{
  app: Sinopebase
  baseUrl: string
}> {
  const reservation = await reserveLoopbackPort()
  const config: AppConfig = {
    port: reservation.port,
    dataDir: join(tmpdir(), `sinopebase-health-${reservation.port}`),
    postgresUrl: '',
    minioEndpoint: '',
    minioAccessKey: '',
    minioSecretKey: '',
    ...overrides,
  }
  const app = new Sinopebase(config)
  await reservation.release()
  await app.start()
  return { app, baseUrl: reservation.origin }
}

/**
 * Snapshot env vars that Sinopebase reads during startup so that
 * parallel test files do not pollute these tests.
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
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/health — liveness', () => {
  let app: Sinopebase
  let baseUrl: string

  beforeAll(async () => {
    ;({ app, baseUrl } = await startTestApp())
  })

  afterAll(async () => {
    await app.stop()
  })

  it('returns 200', async () => {
    const res = await fetch(`${baseUrl}/api/health`)
    expect(res.status).toBe(200)
  })

  it('returns expected JSON shape', async () => {
    const res = await fetch(`${baseUrl}/api/health`)
    const body = await res.json()
    expect(body).toHaveProperty('code', 200)
    expect(body).toHaveProperty('message')
    expect(body).toHaveProperty('mode')
    expect(body).toHaveProperty('tls')
    expect(body).toHaveProperty('db')
    expect(body).toHaveProperty('storage')
  })

  it('includes mode, db, storage, and tls fields', async () => {
    const res = await fetch(`${baseUrl}/api/health`)
    const body = await res.json()
    expect(body.mode).toBe('development')
    expect(body.db).toBe('memory')
    expect(body.storage).toBe('local')
    expect(body.tls).toBe(false)
  })
})

describe('GET /api/ready — readiness', () => {
  let app: Sinopebase
  let baseUrl: string

  beforeAll(async () => {
    ;({ app, baseUrl } = await startTestApp())
  })

  afterAll(async () => {
    await app.stop()
  })

  it('returns 200 when in-memory db is available', async () => {
    const res = await fetch(`${baseUrl}/api/ready`)
    expect(res.status).toBe(200)
  })

  it('returns expected JSON shape', async () => {
    const res = await fetch(`${baseUrl}/api/ready`)
    const body = await res.json()
    expect(body).toHaveProperty('code', 200)
    expect(body).toHaveProperty('status', 'ready')
    expect(body).toHaveProperty('db')
  })

  it('reports memory db type', async () => {
    const res = await fetch(`${baseUrl}/api/ready`)
    const body = await res.json()
    expect(body.db).toBe('memory')
  })
})

describe('GET /api/health returns 200 even in edge conditions', () => {
  it('responds to multiple sequential requests', async () => {
    const { app, baseUrl } = await startTestApp()

    try {
      for (let i = 0; i < 5; i++) {
        const res = await fetch(`${baseUrl}/api/health`)
        expect(res.status).toBe(200)
      }
    } finally {
      await app.stop()
    }
  })

  it('responds to health while server is under light load', async () => {
    const { app, baseUrl } = await startTestApp()

    try {
      const results = await Promise.all([
        fetch(`${baseUrl}/api/health`),
        fetch(`${baseUrl}/api/ready`),
        fetch(`${baseUrl}/api/health`),
        fetch(`${baseUrl}/api/ready`),
      ])
      for (const res of results) {
        expect(res.status).toBe(200)
      }
    } finally {
      await app.stop()
    }
  })
})
