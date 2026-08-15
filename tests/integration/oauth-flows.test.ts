/**
 * OAuth Flows — social sign-in surface end-to-end (full server + PostgreSQL)
 *
 * Closes the codex audit's [P1] gaps for feature 2 (OAuth provider flows):
 *
 *   1. Provider registration via the admin API — POST
 *      /api/admin/oauth-providers returns 201 and the provider appears in
 *      GET /api/admin/oauth-providers.
 *   2. Provider redirect URL — POST /api/auth/sign-in/social (better-auth's
 *      route; the query-string GET form the SDK builds is not accepted)
 *      returns the provider's OAuth authorize URL in the Location header and
 *      the JSON body, with client_id and redirect_uri attached.
 *   3. The OAuth callback route exists — garbage code/state on
 *      /api/auth/callback/:id answers with a defined error redirect, not 404.
 *   4. An unregistered provider id is rejected with an error, not 200.
 *
 * better-auth's provider config is startup-only (src/apis/admin-oauth.ts:
 * "Changes take effect on server restart"), so the google + generic-OIDC
 * providers used by the redirect tests are seeded into the provider store
 * before server.start(); 'apple' is registered at runtime via the admin API.
 * ponytail: pre-seeding the store file — provider config is read once at
 * startup by design; the admin API persists for the next restart.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Sinopebase } from '../../src/core/app'
import { requirePostgres, reserveLoopbackPort } from '../harness'

const JWT_SECRET = 'oauthf-jwt-secret-min-32-chars!!!!!!!'
const SERVICE_ROLE_KEY = 'oauthf-service-role-key-min-32-chars!'
const ANON_KEY = 'oauthf-anon-key-min-32-chars!!!!!!!'

const GOOGLE_CLIENT_ID = 'google-client-123.apps.googleusercontent.com'
const OIDC_PROVIDER_ID = 'myidp'
const OIDC_ISSUER = 'https://idp.example.com'

/** Isolated app data dir — keeps the provider store out of the repo's pb_data. */
const DATA_DIR = mkdtempSync(join(tmpdir(), 'sinopebase-oauth-flows-'))

const ADMIN_HEADERS = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
}

describe('OAuth flows (full server)', () => {
  let server: Sinopebase
  let baseUrl: string

  beforeAll(async () => {
    // Seed google + generic OIDC before start — better-auth reads the store once.
    writeFileSync(
      join(DATA_DIR, 'oauth_providers.json'),
      JSON.stringify(
        [
          { providerId: 'google', clientId: GOOGLE_CLIENT_ID, clientSecret: 'google-secret-abc' },
          {
            providerId: OIDC_PROVIDER_ID,
            clientId: 'oidc-client-456',
            clientSecret: 'oidc-secret-xyz',
            issuer: OIDC_ISSUER,
          },
        ],
        null,
        2,
      ),
    )

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

  /** POST /api/auth/sign-in/social — better-auth's social sign-in route. */
  async function postSignInSocial(provider: string): Promise<Response> {
    return fetch(`${baseUrl}/api/auth/sign-in/social`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider }),
      redirect: 'manual',
    })
  }

  // -------------------------------------------------------------------------
  // 1. Provider registration via the admin API
  // -------------------------------------------------------------------------

  describe('admin provider registration', () => {
    test('registers an Apple provider — 201 and listed by GET', async () => {
      const res = await fetch(`${baseUrl}/api/admin/oauth-providers`, {
        method: 'POST',
        headers: ADMIN_HEADERS,
        body: JSON.stringify({
          providerId: 'apple',
          clientId: 'apple-client-1',
          clientSecret: 'apple-secret-1',
        }),
      })
      expect(res.status).toBe(201)
      const body = (await res.json()) as { provider: { providerId: string; clientSecret: string } }
      expect(body.provider.providerId).toBe('apple')
      expect(body.provider.clientSecret).toBe('••••••••')

      const listRes = await fetch(`${baseUrl}/api/admin/oauth-providers`, {
        headers: ADMIN_HEADERS,
      })
      expect(listRes.status).toBe(200)
      const list = (await listRes.json()) as {
        providers: Array<{ providerId: string; clientId: string }>
      }
      const apple = list.providers.find((p) => p.providerId === 'apple')
      expect(apple).toBeDefined()
      expect(apple?.clientId).toBe('apple-client-1')
      // The startup-seeded providers are listed alongside the runtime one.
      expect(list.providers.some((p) => p.providerId === 'google')).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // 2. Provider redirect URL — better-auth sign-in/social route
  // -------------------------------------------------------------------------

  describe('social sign-in redirect URL', () => {
    test('google — POST sign-in/social returns the Google authorize URL', async () => {
      const res = await postSignInSocial('google')
      // better-auth's OAuth contract: HTTP 200 with a Location header and
      // { url, redirect: true } in the body (the browser follows the URL).
      expect(res.status).toBe(200)
      const location = res.headers.get('location')
      expect(location).toBeTruthy()

      const authorizeUrl = new URL(location as string)
      expect(authorizeUrl.hostname).toBe('accounts.google.com')
      expect(authorizeUrl.pathname).toBe('/o/oauth2/v2/auth')
      expect(authorizeUrl.searchParams.get('response_type')).toBe('code')
      expect(authorizeUrl.searchParams.get('client_id')).toBe(GOOGLE_CLIENT_ID)
      const redirectUri = authorizeUrl.searchParams.get('redirect_uri') ?? ''
      expect(redirectUri).toContain('/api/auth/callback/google')
      expect(redirectUri).toContain('google')
      expect(authorizeUrl.searchParams.get('state')).toBeTruthy()

      const body = (await res.json()) as { url: string; redirect: boolean }
      // location was asserted truthy above; TS cannot narrow through expect().
      expect(body.url).toBe(location as string)
      expect(body.redirect).toBe(true)
    })

    test('google — the GET query-string URL form (SDK signInWithOAuth shape) redirects', async () => {
      // The SDK's signInWithOAuth returns a GET URL for the browser to
      // navigate to. The server proxies that GET into better-auth's POST
      // route and returns the provider redirect.
      const res = await fetch(
        `${baseUrl}/api/auth/sign-in/social?provider=google&callbackURL=${encodeURIComponent(`${baseUrl}/_/`)}`,
        { redirect: 'manual' },
      )
      expect(res.status).toBe(200)
      expect(res.headers.get('location')).toContain('accounts.google.com')
    })

    test('generic OIDC with an unresolvable issuer — registered, sign-in answers a defined error', async () => {
      // Registration accepts the unresolvable hostname (issuer validation
      // allows names that do not resolve; see admin-oauth.ts validateIssuer).
      const listRes = await fetch(`${baseUrl}/api/admin/oauth-providers`, {
        headers: ADMIN_HEADERS,
      })
      expect(listRes.status).toBe(200)
      const list = (await listRes.json()) as {
        providers: Array<{ providerId: string; issuer?: string }>
      }
      const idp = list.providers.find((p) => p.providerId === OIDC_PROVIDER_ID)
      expect(idp).toBeDefined()
      expect(idp?.issuer).toBe(OIDC_ISSUER)

      // POST sign-in/social fetches the OIDC discovery document at request
      // time; the unresolvable issuer makes better-auth throw, and our
      // catch-all maps the failure to a defined 400 — never a 200/redirect,
      // never a hang, never a bare 500.
      const res = await postSignInSocial(OIDC_PROVIDER_ID)
      expect(res.status).toBe(400)
      expect(res.headers.get('location')).toBeNull()
    }, 30_000)
  })

  // -------------------------------------------------------------------------
  // 3. OAuth callback route — exists and answers garbage input, not 404
  // -------------------------------------------------------------------------

  describe('OAuth callback route', () => {
    test('GET /api/auth/callback/google with garbage code/state — defined error redirect', async () => {
      const res = await fetch(
        `${baseUrl}/api/auth/callback/google?code=garbage-code-123&state=garbage-state-456`,
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(res.status)
      const location = res.headers.get('location') ?? ''
      expect(location).toContain('/api/auth/error')
      const errorParam = new URL(location).searchParams.get('error')
      // Current code: state_mismatch (the state JWT does not verify).
      expect(errorParam).toBeTruthy()
    })

    test('POST /api/auth/callback/google with garbage code/state — defined error redirect', async () => {
      const res = await fetch(`${baseUrl}/api/auth/callback/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'garbage-code-123', state: 'garbage-state-456' }),
        redirect: 'manual',
      })
      expect([302, 303]).toContain(res.status)
      // POST first redirects to the GET form of the same callback, which then
      // redirects to the error URL — the route is alive and answers defined.
      const location = res.headers.get('location') ?? ''
      expect(location).toContain('/api/auth/callback/google?')
    })
  })

  // -------------------------------------------------------------------------
  // 4. Unregistered provider id — error, not 200
  // -------------------------------------------------------------------------

  describe('unregistered provider id', () => {
    test('POST sign-in/social — 404 PROVIDER_NOT_FOUND, not 200', async () => {
      const res = await postSignInSocial('ghost-provider')
      expect(res.status).toBe(404)
      const body = (await res.json()) as { message: string; code: string }
      expect(body.code).toBe('PROVIDER_NOT_FOUND')
      expect(body.message).toBe('Provider not found')
    })

    test('GET sign-in/social with an unregistered provider — error, not 200', async () => {
      const res = await fetch(`${baseUrl}/api/auth/sign-in/social?provider=ghost-provider`, {
        redirect: 'manual',
      })
      expect(res.status).not.toBe(200)
      expect(res.status).toBe(404)
      expect(res.headers.get('location')).toBeNull()
    })
  })
})
