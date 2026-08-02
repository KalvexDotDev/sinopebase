/**
 * TLS integration test — HTTPS server with self-signed cert.
 *
 * Verifies:
 * - Server starts with TLS cert and key
 * - HTTPS requests succeed
 * - HSTS header is present
 * - HTTP→HTTPS redirect works (when redirect port is configured)
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { Sinopebase } from '../../src/core/app'

const CERT_DIR = join(import.meta.dirname ?? '.', '.test-certs')
const CERT_PATH = join(CERT_DIR, 'cert.pem')
const KEY_PATH = join(CERT_DIR, 'key.pem')
const TLS_PORT = 9876
const REDIRECT_PORT = 9877

// Check openssl availability at module load — skip all TLS tests if missing
let tlsAvailable = false
try {
  mkdirSync(CERT_DIR, { recursive: true })
  execSync(
    `openssl req -x509 -newkey rsa:2048 -keyout "${KEY_PATH}" -out "${CERT_PATH}" -days 1 -nodes -subj "/CN=localhost"`,
    { stdio: 'pipe' },
  )
  tlsAvailable = existsSync(CERT_PATH) && existsSync(KEY_PATH)
} catch {
  // openssl not available — all tests will skip
}

describe('TLS', () => {
  let app: Sinopebase | null = null

  beforeAll(() => {
    if (!tlsAvailable) return
  })

  afterAll(async () => {
    await app?.stop()
    try {
      unlinkSync(CERT_PATH)
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(KEY_PATH)
    } catch {
      /* ignore */
    }
  })

  const tlsTest = tlsAvailable ? test : test.skip
  tlsTest('server starts with TLS and responds over HTTPS', async () => {
    app = new Sinopebase({
      port: TLS_PORT,
      host: '127.0.0.1',
      tls: { cert: CERT_PATH, key: KEY_PATH },
      httpRedirectPort: REDIRECT_PORT,
      jwtSecret: 'test-jwt-secret-32-chars-minimum!!',
      serviceRoleKey: 'test-service-role-key-32-chars!!',
      anonKey: 'test-anon-key-32-chars-minimum!!',
    })

    await app.start()

    // Make an HTTPS request (accept self-signed cert)
    const httpsRes = await fetch(`https://127.0.0.1:${TLS_PORT}/api/health`, {
      tls: { rejectUnauthorized: false },
    })
    expect(httpsRes.status).toBe(200)

    const body = await httpsRes.json()
    expect(body.tls).toBe(true)
  })

  // NOTE: securityHeaders() middleware is applied globally in base.ts:521,
  // which sets strict-transport-security on every response. This test verifies
  // the header is present. If the middleware is refactored, update this test.
  tlsTest('strict-transport-security header is set on HTTPS responses', async () => {
    if (!app) throw new Error('TLS server not started (prior test must run first)')
    const res = await fetch(`https://127.0.0.1:${TLS_PORT}/api/health`, {
      tls: { rejectUnauthorized: false },
    })
    expect(res.status).toBe(200)
    const hsts = res.headers.get('strict-transport-security')
    // The securityHeaders middleware always sets this header.
    // If null, check that securityHeaders() is wired in base.ts:521.
    expect(hsts).not.toBeNull()
    expect(hsts).toContain('max-age=')
    expect(hsts).toContain('includeSubDomains')
  })

  tlsTest('HTTP→HTTPS redirect works', async () => {
    const res = await fetch(`http://127.0.0.1:${REDIRECT_PORT}/api/health`, {
      redirect: 'manual',
    })
    expect(res.status).toBe(301)
    const location = res.headers.get('location')
    expect(location).not.toBeNull()
    expect(location).toContain('https://')
  })

  tlsTest('health endpoint reports tls: true', async () => {
    const res = await fetch(`https://127.0.0.1:${TLS_PORT}/api/health`, {
      tls: { rejectUnauthorized: false },
    })
    const body = await res.json()
    expect(body.tls).toBe(true)
  })
})
