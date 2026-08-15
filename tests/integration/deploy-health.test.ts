/**
 * Deploy healthcheck ATDD — the exact probe contract deploy platforms use.
 *
 * Railway probes `GET /railway` (platform check) and `GET /api/health`
 * (railway.toml healthcheckPath) every ~30s during and after deploy. A 404
 * or non-2xx on either restarts the container and fails the deployment —
 * this suite exists because that exact failure shipped twice.
 *
 * Covers: both probe routes return 2xx JSON, /api/ready too, all three are
 * rate-limit exempt, and a sustained probe loop (Railway's cadence) never
 * fails.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Sinopebase } from '~/core/app'
import { requirePostgres, reserveLoopbackPort } from '../harness'

let server: Sinopebase
let origin: string
let dataDir: string

beforeAll(async () => {
  const reservation = await reserveLoopbackPort()
  server = new Sinopebase({
    port: reservation.port,
    postgresUrl: requirePostgres(),
    jwtSecret: 'deploy-health-jwt-secret-min-32!',
    serviceRoleKey: 'deploy-health-srvc-key-min-32!!',
    anonKey: 'deploy-health-anon-key-min-32!!!',
  })
  await reservation.release()
  await server.start()
  origin = reservation.origin
  dataDir = server.dataDir()
})

afterAll(async () => {
  await server.stop()
})

describe('deploy healthchecks', () => {
  it('GET /railway returns 200 {status: ok}', async () => {
    const res = await fetch(`${origin}/railway`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('ok')
  })

  it('GET /api/health returns 200 with database and storage mode', async () => {
    const res = await fetch(`${origin}/api/health`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { code: number; db: string; storage: string }
    expect(body.code).toBe(200)
    expect(body.db).toBe('postgresql')
    expect(body.storage).toBe('local')
  })

  it('GET /api/ready returns 2xx', async () => {
    const res = await fetch(`${origin}/api/ready`)
    expect(res.status).toBeGreaterThanOrEqual(200)
    expect(res.status).toBeLessThan(300)
  })

  it('probes are exempt from rate limiting', async () => {
    const reservation = await reserveLoopbackPort()
    const app = new Sinopebase({
      port: reservation.port,
      postgresUrl: requirePostgres(),
      jwtSecret: 'deploy-health-jwt-secret-min-32!',
      serviceRoleKey: 'deploy-health-srvc-key-min-32!!',
      anonKey: 'deploy-health-anon-key-min-32!!!',
      rateLimitMax: 1,
    })
    await reservation.release()
    try {
      await app.start()
      // Exhaust the single token on a non-probe path.
      const blocked = await fetch(`${reservation.origin}/_/test`)
      expect(blocked.status).toBe(200)
      const shouldBlock = await fetch(`${reservation.origin}/_/test`)
      expect(shouldBlock.status).toBe(429)

      // The probes still pass — a rate-limit burst must never fail a deploy.
      for (const path of ['/railway', '/api/health', '/api/ready']) {
        const res = await fetch(`${reservation.origin}${path}`)
        expect(res.status).toBeGreaterThanOrEqual(200)
        expect(res.status).toBeLessThan(300)
      }
    } finally {
      await app.stop()
    }
  })

  it('sustained probe loop at Railway cadence never fails', async () => {
    // 20 probes each, the rough rate of a 30s-interval healthcheck over
    // a deploy window. Each probe must return 2xx within 5s.
    for (let i = 0; i < 20; i++) {
      for (const path of ['/railway', '/api/health']) {
        const res = await fetch(`${origin}${path}`, {
          signal: AbortSignal.timeout(5_000),
        })
        expect(res.status).toBeGreaterThanOrEqual(200)
        expect(res.status).toBeLessThan(300)
      }
    }
  }, 30_000)

  it('healthchecks stay up when the data dir is writable', async () => {
    // The probes must not depend on request-time filesystem writes.
    expect(dataDir.length).toBeGreaterThan(0)
    const res = await fetch(`${origin}/api/health`)
    expect(res.status).toBe(200)
  })
})
