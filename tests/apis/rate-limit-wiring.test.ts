/**
 * Rate limiting wiring integration tests.
 *
 * Verifies that the rate limiter from middlewares_rate_limit.ts is correctly
 * wired into the Sinopebase startup path in app.ts:
 *   - 200 within configured limit
 *   - 429 when limit is exceeded
 *   - Health endpoint bypasses rate limiting
 *   - Per-IP isolation (separate buckets)
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type AppConfig, Sinopebase } from '../../src/core/app'
import { reserveLoopbackPort } from '../harness'

// ---------------------------------------------------------------------------
// Environment isolation — prevent stray env vars from pulling in PostgreSQL
// or S3 infrastructure during these lightweight tests.
// ---------------------------------------------------------------------------

const ISOLATED_ENVIRONMENT_KEYS = [
  'POSTGRES_URL',
  'RUSTFS_ENDPOINT',
  'RUSTFS_ACCESS_KEY',
  'RUSTFS_SECRET_KEY',
] as const

const originalEnvironment = new Map<string, string | undefined>()

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rateLimitConfig(port: number, overrides?: Partial<AppConfig>): AppConfig {
  return {
    port,
    mode: 'development',
    dataDir: join(tmpdir(), `sinopebase-rate-limit-${port}`),
    postgresUrl: '',
    minioEndpoint: '',
    minioAccessKey: '',
    minioSecretKey: '',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('rate limiting wiring', () => {
  it('allows requests within the configured limit', async () => {
    const reservation = await reserveLoopbackPort()
    const app = new Sinopebase(
      rateLimitConfig(reservation.port, { rateLimitMax: 5, rateLimitWindow: 30 }),
    )
    await reservation.release()
    try {
      await app.start()

      for (let i = 0; i < 5; i++) {
        const res = await fetch(`${reservation.origin}/_/test`)
        expect(res.status).toBe(200)
      }
    } finally {
      await app.stop()
      await reservation.release()
    }
  })

  it('returns 429 when the rate limit is exceeded', async () => {
    const reservation = await reserveLoopbackPort()
    const app = new Sinopebase(
      rateLimitConfig(reservation.port, { rateLimitMax: 3, rateLimitWindow: 30 }),
    )
    await reservation.release()
    try {
      await app.start()

      // Consume all tokens
      for (let i = 0; i < 3; i++) {
        const res = await fetch(`${reservation.origin}/_/test`)
        expect(res.status).toBe(200)
      }

      // Next request should be rate limited
      const blocked = await fetch(`${reservation.origin}/_/test`)
      expect(blocked.status).toBe(429)

      const body = await blocked.json()
      expect(body).toHaveProperty('code', 429)
      expect(body).toHaveProperty('message')
    } finally {
      await app.stop()
      await reservation.release()
    }
  })

  it('bypasses rate limiting for /api/health', async () => {
    const reservation = await reserveLoopbackPort()
    const app = new Sinopebase(
      rateLimitConfig(reservation.port, { rateLimitMax: 1, rateLimitWindow: 30 }),
    )
    await reservation.release()
    try {
      await app.start()

      // Consume the only token on a non-health path
      const nonHealth = await fetch(`${reservation.origin}/_/test`)
      expect(nonHealth.status).toBe(200)

      // /api/health should bypass the rate limiter entirely
      const health1 = await fetch(`${reservation.origin}/api/health`)
      expect(health1.status).toBe(200)
      const health2 = await fetch(`${reservation.origin}/api/health`)
      expect(health2.status).toBe(200)
      const health3 = await fetch(`${reservation.origin}/api/health`)
      expect(health3.status).toBe(200)

      // A non-health request should still be blocked
      const blocked = await fetch(`${reservation.origin}/_/test`)
      expect(blocked.status).toBe(429)
    } finally {
      await app.stop()
      await reservation.release()
    }
  })

  it('isolates rate limits per client IP', async () => {
    const reservation = await reserveLoopbackPort()
    const app = new Sinopebase(
      rateLimitConfig(reservation.port, { rateLimitMax: 2, rateLimitWindow: 30 }),
    )
    await reservation.release()
    try {
      await app.start()

      // Exhaust IP-A's budget
      const r1 = await fetch(`${reservation.origin}/_/test`, {
        headers: { 'x-forwarded-for': '10.0.0.1' },
      })
      const r2 = await fetch(`${reservation.origin}/_/test`, {
        headers: { 'x-forwarded-for': '10.0.0.1' },
      })
      expect(r1.status).toBe(200)
      expect(r2.status).toBe(200)

      // IP-A should now be blocked
      const r3 = await fetch(`${reservation.origin}/_/test`, {
        headers: { 'x-forwarded-for': '10.0.0.1' },
      })
      expect(r3.status).toBe(429)

      // IP-B has its own fresh bucket
      const r4 = await fetch(`${reservation.origin}/_/test`, {
        headers: { 'x-forwarded-for': '10.0.0.2' },
      })
      expect(r4.status).toBe(200)
    } finally {
      await app.stop()
      await reservation.release()
    }
  })
})
