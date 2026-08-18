/**
 * OAuth Hardening — Full-Server Integration Tests
 *
 * Covers the v0.7 OAuth hardening surface end-to-end (real server +
 * PostgreSQL), where the codex audit found only unit/config coverage:
 *
 *   1. Issuer URL validation on provider registration (HTTPS-only,
 *      private/loopback IP blocking) — POST /api/admin/oauth-providers.
 *   2. providerId charset enforcement (^[a-zA-Z0-9_-]+$).
 *   3. clientSecret AES-256-GCM encryption at rest — the provider store
 *      (`oauth_providers.json` under the app data dir) must never hold
 *      plaintext, and the app must decrypt on read.
 *   4. Session exchange — POST /api/auth/exchange turns a better-auth
 *      session token into a Bearer token.
 *
 * Providers are stored in a JSON file, not a PostgreSQL table, so the
 * encryption-at-rest assertion reads the file directly.
 * ponytail: direct file read, the store is a file by design (admin-oauth.ts)
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Sinopebase } from '../../src/core/app'
import { decryptClientSecret, isEncrypted } from '../../src/tools/security/oauth-secrets'
import { requirePostgres, reserveLoopbackPort } from '../harness'
import { uniqueEmail } from './setup'

const JWT_SECRET = 'oauh-jwt-secret-min-32-chars!!!!!!'
const SERVICE_ROLE_KEY = 'oauh-service-role-key-min-32-chars!'
const ANON_KEY = 'oauh-anon-key-min-32-chars!!!!!'

/** Isolated app data dir — keeps the provider store out of the repo's pb_data. */
const DATA_DIR = mkdtempSync(join(tmpdir(), 'sinopebase-oauth-hardening-'))

const ADMIN_HEADERS = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
}

const EXCHANGE_CSRF_HEADER = 'x-requested-with'

interface ProviderEntry {
  providerId: string
  clientId: string
  clientSecret: string
  issuer?: string
}

describe('OAuth hardening (full server)', () => {
  let server: Sinopebase
  let baseUrl: string

  beforeAll(async () => {
    const portReservation = await reserveLoopbackPort()
    server = new Sinopebase({
      port: portReservation.port,
      postgresUrl: requirePostgres(),
      jwtSecret: JWT_SECRET,
      serviceRoleKey: SERVICE_ROLE_KEY,
      anonKey: ANON_KEY,
      dataDir: DATA_DIR,
    })
    await portReservation.release()
    await server.start()
    baseUrl = portReservation.origin
  })

  afterAll(async () => {
    await server.stop()
    rmSync(DATA_DIR, { recursive: true, force: true })
  })

  /** Register an OAuth provider via the admin API. */
  async function registerProvider(input: Record<string, string>): Promise<{
    status: number
    body: Record<string, unknown>
  }> {
    const res = await fetch(`${baseUrl}/api/admin/oauth-providers`, {
      method: 'POST',
      headers: ADMIN_HEADERS,
      body: JSON.stringify(input),
    })
    return { status: res.status, body: (await res.json()) as Record<string, unknown> }
  }

  /** Read the provider store file the admin plugin persists to. */
  function readProviderStore(): ProviderEntry[] {
    const raw = readFileSync(join(DATA_DIR, 'oauth_providers.json'), 'utf-8')
    return JSON.parse(raw) as ProviderEntry[]
  }

  // -------------------------------------------------------------------------
  // 1. Issuer validation (server-side)
  // -------------------------------------------------------------------------

  describe('issuer validation', () => {
    test('rejects a non-HTTPS issuer (http://127.0.0.1)', async () => {
      const res = await registerProvider({
        providerId: `http-loopback-${Date.now()}`,
        clientId: 'cid',
        clientSecret: 'sec',
        issuer: 'http://127.0.0.1:9999',
      })
      expect(res.status).toBe(400)
      expect(res.body.message).toBe('Issuer must use HTTPS.')
    })

    test('rejects a non-HTTPS issuer (public http host)', async () => {
      const res = await registerProvider({
        providerId: `http-public-${Date.now()}`,
        clientId: 'cid',
        clientSecret: 'sec',
        issuer: 'http://example.com',
      })
      expect(res.status).toBe(400)
      expect(res.body.message).toBe('Issuer must use HTTPS.')
    })

    test('rejects loopback and private-IP issuers even over HTTPS', async () => {
      const blocked = [
        'https://localhost',
        'https://[::1]',
        'https://10.0.0.5',
        'https://192.168.1.10',
        'https://172.16.0.1',
      ]
      for (const issuer of blocked) {
        const res = await registerProvider({
          providerId: `blocked-${issuer.replace(/[^a-z0-9]/gi, '-')}-${Date.now()}`,
          clientId: 'cid',
          clientSecret: 'sec',
          issuer,
        })
        expect(res.status).toBe(400)
        expect(res.body.message).toBe('Issuer must not be a private or loopback address.')
      }
    })

    test('rejects an issuer that is not a valid URL', async () => {
      const res = await registerProvider({
        providerId: `bad-url-${Date.now()}`,
        clientId: 'cid',
        clientSecret: 'sec',
        issuer: 'https://not a url',
      })
      expect(res.status).toBe(400)
      expect(res.body.message).toBe('Issuer must be a valid URL.')
    })

    test('accepts a valid HTTPS issuer', async () => {
      const res = await registerProvider({
        providerId: `valid-issuer-${Date.now()}`,
        clientId: 'cid',
        clientSecret: 'sec',
        issuer: 'https://idp.example.com/realms/demo',
      })
      expect(res.status).toBe(201)
      const provider = res.body.provider as { providerId: string; issuer: string }
      expect(provider.issuer).toBe('https://idp.example.com/realms/demo')
    })

    test('PATCH validates issuer changes too', async () => {
      const providerId = `patch-issuer-${Date.now()}`
      await registerProvider({
        providerId,
        clientId: 'cid',
        clientSecret: 'sec',
        issuer: 'https://idp.example.com',
      })
      const res = await fetch(`${baseUrl}/api/admin/oauth-providers/${providerId}`, {
        method: 'PATCH',
        headers: ADMIN_HEADERS,
        body: JSON.stringify({ issuer: 'http://127.0.0.1:8080' }),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { message: string }
      expect(body.message).toBe('Issuer must use HTTPS.')
    })
  })

  // -------------------------------------------------------------------------
  // 2. providerId charset enforcement
  // -------------------------------------------------------------------------

  describe('providerId charset', () => {
    test('rejects providerId with spaces and punctuation', async () => {
      const res = await registerProvider({
        providerId: 'bad id!',
        clientId: 'cid',
        clientSecret: 'sec',
      })
      expect(res.status).toBe(400)
      expect(res.body.message).toBe('providerId must match ^[a-zA-Z0-9_-]+$.')
    })

    test('rejects providerId longer than 128 characters', async () => {
      const res = await registerProvider({
        providerId: 'a'.repeat(129),
        clientId: 'cid',
        clientSecret: 'sec',
      })
      expect(res.status).toBe(400)
      expect(res.body.message).toBe('providerId must be 1-128 characters.')
    })

    test('accepts providerId with letters, digits, underscore, and hyphen', async () => {
      const providerId = `acme-id_2-${Date.now()}`
      const res = await registerProvider({ providerId, clientId: 'cid', clientSecret: 'sec' })
      expect(res.status).toBe(201)
      expect((res.body.provider as { providerId: string }).providerId).toBe(providerId)
    })
  })

  // -------------------------------------------------------------------------
  // 3. clientSecret encryption at rest
  // -------------------------------------------------------------------------

  describe('clientSecret encryption at rest', () => {
    test('stores ciphertext (not plaintext) and decrypts back to the original', async () => {
      const plaintext = 'super-secret-client-secret-123'
      const providerId = `enc-at-rest-${Date.now()}`
      const res = await registerProvider({
        providerId,
        clientId: 'cid-enc',
        clientSecret: plaintext,
        issuer: 'https://idp.example.com',
      })
      expect(res.status).toBe(201)

      const stored = readProviderStore().find((p) => p.providerId === providerId)
      expect(stored).toBeDefined()
      expect(stored?.clientSecret).not.toBe(plaintext)
      expect(isEncrypted(stored?.clientSecret ?? '')).toBe(true)
      expect(decryptClientSecret(stored?.clientSecret ?? '', JWT_SECRET)).toBe(plaintext)
    })

    test('re-listing providers decrypts on read and redacts the secret', async () => {
      const plaintext = 'another-plaintext-secret-456'
      const providerId = `enc-read-${Date.now()}`
      await registerProvider({
        providerId,
        clientId: 'cid-read',
        clientSecret: plaintext,
      })

      const res = await fetch(`${baseUrl}/api/admin/oauth-providers`, {
        headers: ADMIN_HEADERS,
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        providers: Array<{ providerId: string; clientSecret: string }>
      }
      const listed = body.providers.find((p) => p.providerId === providerId)
      expect(listed).toBeDefined()
      expect(listed?.clientSecret).toBe('••••••••')
      expect(listed?.clientSecret).not.toBe(plaintext)
    })
  })

  // -------------------------------------------------------------------------
  // 4. Session exchange — POST /api/auth/exchange
  // -------------------------------------------------------------------------

  describe('session exchange', () => {
    const email = uniqueEmail()
    const password = 'oauth-hardening-password-123!'
    let sessionToken = ''
    let sessionCookie = ''

    test('signs up and signs in to obtain a session token', async () => {
      const supabaseHeaders = {
        'Content-Type': 'application/json',
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
      }
      const signup = await fetch(`${baseUrl}/auth/v1/signup`, {
        method: 'POST',
        headers: supabaseHeaders,
        body: JSON.stringify({ email, password }),
      })
      expect(signup.status).toBe(200)

      const signIn = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: supabaseHeaders,
        body: JSON.stringify({ email, password }),
      })
      expect(signIn.status).toBe(200)
      const body = (await signIn.json()) as { access_token: string }
      sessionToken = body.access_token
      expect(sessionToken).toBeTruthy()

      // The GoTrue-style sign-in forwards better-auth's session cookie so
      // cookie-based flows (session exchange, admin UI login) work directly.
      const setCookies = signIn.headers.getSetCookie()
      const setCookie = setCookies.find((c) => c.startsWith('better-auth.session_token='))
      expect(setCookie).toBeTruthy()
      sessionCookie = setCookie?.slice(0, setCookie.indexOf(';')) ?? ''
    })

    test('exchanges a valid session cookie for a Bearer token', async () => {
      expect(sessionToken).toBeTruthy()
      const res = await fetch(`${baseUrl}/api/auth/exchange`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [EXCHANGE_CSRF_HEADER]: 'sinopebase-admin',
          cookie: sessionCookie,
        },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        access_token: string
        token_type: string
        expires_in: number
        user: { email: string }
      }
      expect(body.access_token).toBe(sessionToken)
      expect(body.token_type).toBe('bearer')
      expect(body.expires_in).toBeGreaterThan(0)
      expect(body.user.email).toBe(email)
    })

    test('exchanged token works as a Bearer token on /auth/v1/user', async () => {
      expect(sessionToken).toBeTruthy()
      const res = await fetch(`${baseUrl}/api/auth/exchange`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [EXCHANGE_CSRF_HEADER]: 'sinopebase-admin',
          cookie: sessionCookie,
        },
      })
      const body = (await res.json()) as { access_token: string }
      const user = await fetch(`${baseUrl}/auth/v1/user`, {
        headers: { Authorization: `Bearer ${body.access_token}` },
      })
      expect(user.status).toBe(200)
      const userBody = (await user.json()) as { email: string }
      expect(userBody.email).toBe(email)
    })

    test('rejects the exchange with no session cookie', async () => {
      const res = await fetch(`${baseUrl}/api/auth/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [EXCHANGE_CSRF_HEADER]: 'sinopebase-admin' },
      })
      expect(res.status).toBe(401)
      const body = (await res.json()) as { message: string }
      expect(body.message).toBe('No active session')
    })

    test('rejects the exchange with a garbage session cookie', async () => {
      const res = await fetch(`${baseUrl}/api/auth/exchange`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [EXCHANGE_CSRF_HEADER]: 'sinopebase-admin',
          cookie: 'better-auth.session_token=not-a-real-session-token',
        },
      })
      expect(res.status).toBe(401)
      const body = (await res.json()) as { message: string }
      expect(body.message).toBe('No active session')
    })

    test('rejects the exchange without the CSRF header even with a valid cookie', async () => {
      expect(sessionToken).toBeTruthy()
      const res = await fetch(`${baseUrl}/api/auth/exchange`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: sessionCookie,
        },
      })
      expect(res.status).toBe(403)
      const body = (await res.json()) as { message: string }
      expect(body.message).toBe('CSRF protection: missing X-Requested-With header')
    })
  })
})
