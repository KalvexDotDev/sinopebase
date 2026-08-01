/**
 * TLS integration test — HTTPS server with self-signed cert.
 *
 * Verifies:
 * - Server starts with TLS cert and key
 * - HTTPS requests succeed
 * - HSTS header is present
 * - HTTP→HTTPS redirect works (when redirect port is configured)
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { Sinopebase } from '../../src/core/app'
import { execSync } from 'node:child_process'
import { existsSync, unlinkSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const CERT_DIR = join(import.meta.dirname ?? '.', '.test-certs')
const CERT_PATH = join(CERT_DIR, 'cert.pem')
const KEY_PATH = join(CERT_DIR, 'key.pem')
const TLS_PORT = 9876
const REDIRECT_PORT = 9877

describe('TLS', () => {
  let app: Sinopebase | null = null

  beforeAll(() => {
    // Generate self-signed cert for testing
    mkdirSync(CERT_DIR, { recursive: true })
    try {
      execSync(
        `openssl req -x509 -newkey rsa:2048 -keyout "${KEY_PATH}" -out "${CERT_PATH}" -days 1 -nodes -subj "/CN=localhost"`,
        { stdio: 'pipe' },
      )
    } catch {
      // If openssl is not available, skip TLS tests
    }

    if (!existsSync(CERT_PATH) || !existsSync(KEY_PATH)) {
      throw new Error('Failed to generate test certificate. Ensure openssl is installed.')
    }
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

  test('server starts with TLS and responds over HTTPS', async () => {
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

  test('HSTS header is present on HTTPS responses', async () => {
    const res = await fetch(`https://127.0.0.1:${TLS_PORT}/api/health`, {
      tls: { rejectUnauthorized: false },
    })
    const hsts = res.headers.get('strict-transport-security')
    expect(hsts).not.toBeNull()
    expect(hsts).toContain('max-age=31536000')
    expect(hsts).toContain('includeSubDomains')
  })

  test('HTTP→HTTPS redirect works', async () => {
    const res = await fetch(`http://127.0.0.1:${REDIRECT_PORT}/api/health`, {
      redirect: 'manual',
    })
    expect(res.status).toBe(301)
    const location = res.headers.get('location')
    expect(location).not.toBeNull()
    expect(location).toContain('https://')
  })

  test('health endpoint reports tls: true', async () => {
    const res = await fetch(`https://127.0.0.1:${TLS_PORT}/api/health`, {
      tls: { rejectUnauthorized: false },
    })
    const body = await res.json()
    expect(body.tls).toBe(true)
  })
})
