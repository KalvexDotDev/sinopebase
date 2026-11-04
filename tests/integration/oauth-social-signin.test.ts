/**
 * Google and Microsoft sign-in through supabase-js (sinope#1097), full server
 * plus PostgreSQL, against a mocked OIDC provider.
 *
 * The provider is mocked at its token endpoint: the test plays the browser
 * (following redirects with a cookie jar) and the provider (answering the
 * authorization step itself), and the server's own token-endpoint fetch is
 * answered with an ID token carrying the identity under test. Everything in
 * between is the real Sinopebase and Better Auth code.
 *
 * @new-code-test positive src/apis/auth-oauth.ts
 * @new-code-test negative src/apis/auth-oauth.ts
 * @new-code-test positive src/apis/auth.ts
 * @new-code-test negative src/apis/auth.ts
 * @new-code-test positive src/tools/auth-better/index.ts
 * @new-code-test negative src/tools/auth-better/index.ts
 * @new-code-test positive src/tools/auth-better/oauth-flows.ts
 * @new-code-test negative src/tools/auth-better/oauth-flows.ts
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { Pool } from 'pg'
import { Sinopebase } from '~/core/app'
import { requirePostgres, reserveLoopbackPort } from '../harness'

const ANON_KEY = 'oauthsi-anon-key-min-32-chars!!!!!!!'
const APP_ORIGIN = 'https://app.sinope.test'
const REDIRECT_TO = `${APP_ORIGIN}/auth/callback`
const SITE_URL = `${APP_ORIGIN}/`
const TENANT = '6fdb255f-1111-4111-8111-111111111111'
const HOSTILE_TENANT = '0bad0bad-2222-4222-8222-222222222222'

const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'
const MICROSOFT_TOKEN = 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token'

type Claims = Record<string, unknown>

/** The identity the mocked provider asserts at its next token exchange. */
let nextClaims: Claims = {}

function unsignedJwt(claims: Claims) {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${part({ alg: 'RS256', typ: 'JWT' })}.${part(claims)}.signature`
}

const realFetch = globalThis.fetch
function mockProviderFetch() {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.startsWith(GOOGLE_TOKEN) || url.startsWith(MICROSOFT_TOKEN))
      return Response.json({
        access_token: 'provider-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        id_token: unsignedJwt(nextClaims),
      })
    return realFetch(input, init)
  }) as typeof fetch
}

const unique = () => crypto.randomUUID().slice(0, 8)
const googleClaims = (email: string, emailVerified: boolean, sub = `g-${unique()}`) => ({
  iss: 'https://accounts.google.com',
  aud: 'google-client',
  sub,
  email,
  email_verified: emailVerified,
  name: 'Google Person',
})
const microsoftClaims = (tid: string, oid: string, email: string) => ({
  iss: `https://login.microsoftonline.com/${tid}/v2.0`,
  aud: 'microsoft-client',
  tid,
  oid,
  sub: `pairwise-${unique()}`,
  email,
  // A hostile tenant can claim anything here; none of it is authoritative.
  email_verified: true,
  verified_primary_email: [email],
  name: 'Microsoft Person',
})

/** A browser: follows redirects by hand and keeps cookies across origins we serve. */
class Browser {
  private cookies = new Map<string, string>()

  async get(url: string): Promise<Response> {
    const response = await realFetch(url, {
      redirect: 'manual',
      headers: { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') },
    })
    for (const cookie of response.headers.getSetCookie()) {
      const [pair, ...attributes] = cookie.split(';')
      const [name, ...value] = (pair ?? '').split('=')
      const expired = attributes.some((a) => a.trim().toLowerCase() === 'max-age=0')
      if (expired || value.join('=') === '') this.cookies.delete(name?.trim() ?? '')
      else this.cookies.set(name?.trim() ?? '', value.join('='))
    }
    return response
  }

  /**
   * Open an authorize URL, act as the provider for `claims`, and return where the
   * flow lands on the app (redirect_to with `code` or an error).
   */
  async signInAt(url: string, claims: Claims): Promise<URL> {
    const toProvider = await this.get(url)
    expect(toProvider.status).toBe(302)
    const providerUrl = new URL(toProvider.headers.get('location') ?? '')
    const callback = new URL(providerUrl.searchParams.get('redirect_uri') ?? '')
    callback.searchParams.set('code', 'provider-code')
    callback.searchParams.set('state', providerUrl.searchParams.get('state') ?? '')
    nextClaims = claims
    let response = await this.get(callback.href)
    // Better Auth's callback, then /auth/v1/oauth/complete, then the app.
    while (response.status === 302) {
      const location = new URL(response.headers.get('location') ?? '')
      if (location.origin === APP_ORIGIN) return location
      response = await this.get(location.href)
    }
    throw new Error(`OAuth flow stopped at ${response.status}: ${await response.text()}`)
  }
}

describe('Google and Microsoft sign-in (supabase-js PKCE)', () => {
  let app: Sinopebase
  let baseUrl: string
  let pool: Pool
  let originalAuthUrl: string | undefined

  function client(): SupabaseClient {
    const store = new Map<string, string>()
    return createClient(baseUrl, ANON_KEY, {
      auth: {
        flowType: 'pkce',
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storage: {
          getItem: (key) => store.get(key) ?? null,
          setItem: (key, value) => void store.set(key, value),
          removeItem: (key) => void store.delete(key),
        },
      },
    })
  }

  /** Sign in with a provider through supabase-js; returns the client and where the flow landed. */
  async function socialSignIn(provider: 'google' | 'azure', claims: Claims) {
    const supabase = client()
    const { data, error } = await supabase.auth.signInWithOAuth({
      // supabase-js names Microsoft 'azure'; Sinopebase's provider id is 'microsoft'.
      provider: provider === 'azure' ? ('microsoft' as 'azure') : provider,
      options: { redirectTo: REDIRECT_TO, skipBrowserRedirect: true },
    })
    expect(error).toBeNull()
    const landed = await new Browser().signInAt(data.url ?? '', claims)
    return { supabase, landed }
  }

  async function signedIn(provider: 'google' | 'azure', claims: Claims) {
    const { supabase, landed } = await socialSignIn(provider, claims)
    const code = landed.searchParams.get('code')
    expect(landed.searchParams.get('error_code')).toBeNull()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code ?? '')
    expect(error).toBeNull()
    return { supabase, user: data.user }
  }

  async function passwordUser(email: string, verified: boolean) {
    const supabase = client()
    const { data, error } = await supabase.auth.signUp({ email, password: 'password-12345' })
    expect(error).toBeNull()
    await pool.query('UPDATE "user" SET "emailVerified" = $2 WHERE id = $1', [
      data.user?.id,
      verified,
    ])
    return { supabase, userId: data.user?.id ?? '' }
  }

  async function identities(supabase: SupabaseClient) {
    const { data, error } = await supabase.auth.getUserIdentities()
    expect(error).toBeNull()
    return data?.identities ?? []
  }

  beforeAll(async () => {
    mockProviderFetch()
    pool = new Pool({ connectionString: requirePostgres() })
    const port = await reserveLoopbackPort()
    app = new Sinopebase({
      port: port.port,
      postgresUrl: requirePostgres(),
      jwtSecret: 'oauthsi-jwt-secret-min-32-chars!!!!!',
      serviceRoleKey: 'oauthsi-service-key-min-32-chars!!!!',
      anonKey: ANON_KEY,
      extraOrigins: [APP_ORIGIN],
      siteUrl: SITE_URL,
      oauthProviders: [
        { providerId: 'google', clientId: 'google-client', clientSecret: 'google-secret' },
        {
          providerId: 'microsoft',
          clientId: 'microsoft-client',
          clientSecret: 'microsoft-secret',
          tenantId: 'organizations',
        },
      ],
    })
    await port.release()
    // Better Auth builds the provider redirect URI and the completion URL from this.
    originalAuthUrl = process.env.BETTER_AUTH_URL
    process.env.BETTER_AUTH_URL = port.origin
    await app.start()
    baseUrl = port.origin
  })

  afterAll(async () => {
    globalThis.fetch = realFetch
    if (originalAuthUrl === undefined) delete process.env.BETTER_AUTH_URL
    else process.env.BETTER_AUTH_URL = originalAuthUrl
    await app.stop()
    await pool.end()
  })

  describe('sign-up', () => {
    test('a new Google user signs up and receives a session for their verified email', async () => {
      const email = `new-google-${unique()}@example.test`
      const { supabase, user } = await signedIn('google', googleClaims(email, true))
      expect(user?.email).toBe(email)
      expect(user?.email_confirmed_at).toBeTruthy()
      expect((await identities(supabase)).map((i) => i.provider)).toEqual(['google'])
    })

    test('a new Microsoft user is keyed on tenant and object ID; the email stays unverified', async () => {
      const oid = crypto.randomUUID()
      const email = `new-ms-${unique()}@contoso.test`
      const { supabase, user } = await signedIn('azure', microsoftClaims(TENANT, oid, email))
      expect(user?.email).toBe(email)
      expect(user?.email_confirmed_at).toBeUndefined()
      const [identity] = await identities(supabase)
      expect(identity?.provider).toBe('microsoft')
      expect(identity?.id).toBe(`${TENANT}:${oid}`)

      // The same tenant and object sign in again whatever the email claim now says.
      const again = await signedIn('azure', microsoftClaims(TENANT, oid, `renamed-${email}`))
      expect(again.user?.id).toBe(user?.id)
    })
  })

  describe('Identity Linking Policy', () => {
    test('links Google into an existing account on a provider-verified email', async () => {
      const email = `link-${unique()}@example.test`
      const { userId } = await passwordUser(email, true)
      const { supabase, user } = await signedIn('google', googleClaims(email, true))
      expect(user?.id).toBe(userId)
      expect((await identities(supabase)).map((i) => i.provider).sort()).toEqual([
        'email',
        'google',
      ])
    })

    test('refuses to link on an email the provider has not verified', async () => {
      const email = `unverified-${unique()}@example.test`
      const { userId } = await passwordUser(email, true)
      const { landed } = await socialSignIn('google', googleClaims(email, false))
      expect(landed.searchParams.get('error')).toBe('access_denied')
      expect(landed.searchParams.get('error_code')).toBe('provider_email_unverified')
      const links = await pool.query(
        'SELECT 1 FROM account WHERE "userId" = $1 AND "providerId" = $2',
        [userId, 'google'],
      )
      expect(links.rowCount).toBe(0)
    })

    test('refuses to link into an account whose own email was never verified', async () => {
      const email = `prehijack-${unique()}@example.test`
      const { userId } = await passwordUser(email, false)
      const { landed } = await socialSignIn('google', googleClaims(email, true))
      expect(landed.searchParams.get('error')).toBe('access_denied')
      expect(landed.searchParams.get('code')).toBeNull()
      const links = await pool.query(
        'SELECT 1 FROM account WHERE "userId" = $1 AND "providerId" = $2',
        [userId, 'google'],
      )
      expect(links.rowCount).toBe(0)
    })

    test('a spoofed Microsoft email claim never links or signs in to the account it names', async () => {
      const email = `victim-${unique()}@example.test`
      const { userId } = await passwordUser(email, true)
      const { landed } = await socialSignIn(
        'azure',
        microsoftClaims(HOSTILE_TENANT, crypto.randomUUID(), email),
      )
      expect(landed.searchParams.get('code')).toBeNull()
      expect(landed.searchParams.get('error_code')).toBe('email_claim_not_authoritative')
      const accounts = await pool.query('SELECT "providerId" FROM account WHERE "userId" = $1', [
        userId,
      ])
      expect(accounts.rows).toEqual([{ providerId: 'credential' }])
      const users = await pool.query('SELECT 1 FROM "user" WHERE lower(email) = $1', [email])
      expect(users.rowCount).toBe(1)
    })

    test('a link ticket opened in another browser keeps nothing it cannot redeem', async () => {
      // An attacker mints a link URL for their own account and gets a victim to open it.
      const { supabase: attacker, userId } = await passwordUser(
        `attacker-${unique()}@example.test`,
        true,
      )
      const { data } = await attacker.auth.linkIdentity({
        provider: 'google',
        options: { redirectTo: REDIRECT_TO, skipBrowserRedirect: true },
      })
      const victim = googleClaims(`victim-${unique()}@example.test`, true)
      const landed = await new Browser().signInAt(data.url ?? '', victim)
      const code = landed.searchParams.get('code') ?? ''
      expect(code).not.toBe('')

      // Until the code is redeemed, the victim's Google identity signs in to nobody.
      const meanwhile = await socialSignIn('google', victim)
      expect(meanwhile.landed.searchParams.get('error_code')).toBe('identity_link_pending')

      // The victim's browser holds no verifier for the attacker's flow.
      const wrong = await realFetch(`${baseUrl}/auth/v1/token?grant_type=pkce`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ auth_code: code, code_verifier: 'v'.repeat(64) }),
      })
      expect(wrong.status).toBe(400)
      const links = await pool.query(
        'SELECT 1 FROM account WHERE "userId" = $1 AND "providerId" = $2',
        [userId, 'google'],
      )
      expect(links.rowCount).toBe(0)
    })

    test('recovery that first proves the mailbox drops identities that only claimed it', async () => {
      const email = `squatted-${unique()}@example.test`
      const { user } = await signedIn(
        'azure',
        microsoftClaims(HOSTILE_TENANT, crypto.randomUUID(), email),
      )
      const token = `recovery${unique()}${unique()}`
      const expires = new Date(Date.now() + 60_000)
      await pool.query(
        `INSERT INTO verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, now(), now()), ($5, $6, $7, $4, now(), now())`,
        [
          crypto.randomUUID(),
          `reset-password:${token}`,
          user?.id,
          expires,
          crypto.randomUUID(),
          `recovery-email:${token}`,
          email,
        ],
      )
      const { error } = await client().auth.verifyOtp({ type: 'recovery', token_hash: token })
      expect(error).toBeNull()
      const accounts = await pool.query('SELECT "providerId" FROM account WHERE "userId" = $1', [
        user?.id,
      ])
      expect(accounts.rowCount).toBe(0)
    })
  })

  describe('Account sign-in methods', () => {
    test('a signed-in user links Microsoft under another email, then unlinks it', async () => {
      const email = `explicit-${unique()}@example.test`
      const { supabase, userId } = await passwordUser(email, false)
      const { data, error } = await supabase.auth.linkIdentity({
        provider: 'microsoft' as 'azure',
        options: { redirectTo: REDIRECT_TO, skipBrowserRedirect: true },
      })
      expect(error).toBeNull()
      const oid = crypto.randomUUID()
      const landed = await new Browser().signInAt(
        data.url ?? '',
        microsoftClaims(TENANT, oid, `work-${email}`),
      )
      const exchanged = await supabase.auth.exchangeCodeForSession(
        landed.searchParams.get('code') ?? '',
      )
      expect(exchanged.error).toBeNull()
      expect(exchanged.data.user?.id).toBe(userId)

      const linked = await identities(supabase)
      expect(linked.map((i) => i.provider).sort()).toEqual(['email', 'microsoft'])
      const microsoft = linked.find((i) => i.provider === 'microsoft')
      expect(microsoft?.id).toBe(`${TENANT}:${oid}`)

      expect((await supabase.auth.unlinkIdentity(microsoft as never)).error).toBeNull()
      expect((await identities(supabase)).map((i) => i.provider)).toEqual(['email'])
    })

    test('refuses to unlink the last sign-in method', async () => {
      const { supabase } = await signedIn(
        'google',
        googleClaims(`only-google-${unique()}@example.test`, true),
      )
      const [google] = await identities(supabase)
      const { error } = await supabase.auth.unlinkIdentity(google as never)
      expect(error?.status).toBe(422)
      expect(error?.code).toBe('single_identity_not_deletable')
      expect((await identities(supabase)).map((i) => i.provider)).toEqual(['google'])
    })

    test('a passwordless user sets a password without a current one and signs in with it', async () => {
      const email = `set-password-${unique()}@example.test`
      const { supabase } = await signedIn('google', googleClaims(email, true))
      const { error } = await supabase.auth.updateUser({ password: 'first-password-123' })
      expect(error).toBeNull()
      expect((await identities(supabase)).map((i) => i.provider).sort()).toEqual([
        'email',
        'google',
      ])
      const password = await client().auth.signInWithPassword({
        email,
        password: 'first-password-123',
      })
      expect(password.error).toBeNull()
    })
  })

  describe('PKCE flow integrity', () => {
    test('an auth code is single-use and bound to its code verifier', async () => {
      const { supabase, landed } = await socialSignIn(
        'google',
        googleClaims(`pkce-${unique()}@example.test`, true),
      )
      const code = landed.searchParams.get('code') ?? ''
      const wrong = await realFetch(`${baseUrl}/auth/v1/token?grant_type=pkce`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ auth_code: code, code_verifier: 'x'.repeat(64) }),
      })
      expect(wrong.status).toBe(400)
      expect(await wrong.json()).toMatchObject({ error_code: 'bad_code_verifier' })
      // The failed attempt consumed the code.
      expect((await supabase.auth.exchangeCodeForSession(code)).error?.code).toBe(
        'flow_state_not_found',
      )
    })

    test('refuses a non-PKCE authorize request and an unconfigured provider', async () => {
      const plain = await realFetch(
        `${baseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(REDIRECT_TO)}`,
        { redirect: 'manual' },
      )
      expect(plain.status).toBe(400)
      const unknown = await realFetch(
        `${baseUrl}/auth/v1/authorize?provider=github&code_challenge=${'a'.repeat(43)}&code_challenge_method=s256`,
        { redirect: 'manual' },
      )
      expect(unknown.status).toBe(400)
    })

    test('an untrusted redirect_to falls back to the site URL', async () => {
      const supabase = client()
      const { data } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: 'https://evil.test/steal', skipBrowserRedirect: true },
      })
      const landed = await new Browser().signInAt(
        data.url ?? '',
        googleClaims(`redirect-${unique()}@example.test`, true),
      )
      expect(landed.href.startsWith(SITE_URL)).toBe(true)
    })

    test('completing a flow from another browser is refused', async () => {
      const supabase = client()
      const { data } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: REDIRECT_TO, skipBrowserRedirect: true },
      })
      const victim = new Browser()
      const toProvider = await victim.get(data.url ?? '')
      const state = new URL(toProvider.headers.get('location') ?? '').searchParams.get('state')
      // The completion URL rides Better Auth's server-side state as its callbackURL.
      const stored = await pool.query<{ value: string }>(
        'SELECT value FROM verification WHERE identifier = $1',
        [`auth-state:${state}`],
      )
      const { callbackURL } = JSON.parse(stored.rows[0]?.value ?? '{}')
      expect(String(callbackURL)).toContain('/auth/v1/oauth/complete?flow=')
      const elsewhere = await new Browser().get(String(callbackURL))
      expect(elsewhere.status).toBe(400)
    })
  })
})
