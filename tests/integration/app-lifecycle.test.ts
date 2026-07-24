import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Sinopebase, type AppConfig } from '../../src/core/app'
import { MastraPlugin } from '../../src/plugins/mastra/plugin'
import { reserveLoopbackPort } from '../harness'

const ISOLATED_ENVIRONMENT_KEYS = [
  'POSTGRES_URL',
  'RUSTFS_ENDPOINT',
  'RUSTFS_ACCESS_KEY',
  'RUSTFS_SECRET_KEY',
] as const

const originalEnvironment = new Map<string, string | undefined>()

interface LifecycleInternals {
  server: unknown | null
  pendingServer: unknown | null
}

beforeAll(() => {
  for (const key of ISOLATED_ENVIRONMENT_KEYS) {
    originalEnvironment.set(key, process.env[key])
    process.env[key] = ''
  }
})

afterAll(() => {
  for (const key of ISOLATED_ENVIRONMENT_KEYS) {
    const original = originalEnvironment.get(key)
    if (original === undefined) delete process.env[key]
    else process.env[key] = original
  }
})

function localConfig(port: number): AppConfig {
  const disabledRemote = ''
  return {
    port,
    dataDir: join(tmpdir(), `sinopebase-app-lifecycle-${port}`),
    postgresUrl: disabledRemote,
    minioEndpoint: disabledRemote,
    minioAccessKey: disabledRemote,
    minioSecretKey: disabledRemote,
  }
}

function lifecycleInternals(app: Sinopebase): LifecycleInternals {
  return app as unknown as LifecycleInternals
}

async function waitForPendingServer(app: Sinopebase): Promise<void> {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const lifecycle = lifecycleInternals(app)
    if (lifecycle.pendingServer !== null) return
    if (lifecycle.server !== null) break
    await Promise.resolve()
  }

  throw new Error('startup completed before the in-flight server could be observed')
}

describe('Sinopebase lifecycle', () => {
  it('stops a server when stop is requested during in-flight start', async () => {
    const reservation = await reserveLoopbackPort()
    const app = new Sinopebase(localConfig(reservation.port))
    await reservation.release()

    try {
      const starting = app.start()
      await waitForPendingServer(app)
      const stopping = app.stop()

      await Promise.all([starting, stopping])

      expect(lifecycleInternals(app).server).toBeNull()
      expect(lifecycleInternals(app).pendingServer).toBeNull()
      expect(app.getDatabase()).toBeNull()
      await expect(fetch(`${reservation.origin}/api/health`)).rejects.toThrow()
    } finally {
      await app.stop()
      await reservation.release()
    }
  })

  it('makes duplicate start and stop calls idempotent', async () => {
    const reservation = await reserveLoopbackPort()
    const app = new Sinopebase(localConfig(reservation.port))
    await reservation.release()

    try {
      await Promise.all([app.start(), app.start()])
      const health = await fetch(`${reservation.origin}/api/health`)
      expect(health.status).toBe(200)

      await Promise.all([app.stop(), app.stop()])

      expect(lifecycleInternals(app).server).toBeNull()
      expect(app.getDatabase()).toBeNull()
      await expect(fetch(`${reservation.origin}/api/health`)).rejects.toThrow()
    } finally {
      await app.stop()
      await reservation.release()
    }
  })

  it('cleans partial startup state and remains stoppable after start fails', async () => {
    const reservation = await reserveLoopbackPort()
    const app = new Sinopebase(localConfig(reservation.port))
    const register = MastraPlugin.prototype.register
    MastraPlugin.prototype.register = async () => {
      throw new Error('forced plugin registration failure')
    }
    await reservation.release()

    try {
      await expect(app.start()).rejects.toThrow('forced plugin registration failure')

      expect(lifecycleInternals(app).server).toBeNull()
      expect(lifecycleInternals(app).pendingServer).toBeNull()
      expect(app.getDatabase()).toBeNull()
      expect(app.getFileStore()).toBeNull()
      await app.stop()
      await app.stop()
    } finally {
      MastraPlugin.prototype.register = register
      await app.stop()
      await reservation.release()
    }
  })
})
