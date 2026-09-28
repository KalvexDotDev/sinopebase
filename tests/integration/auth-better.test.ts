// @new-code-test positive src/apis/auth.ts
// @new-code-test negative src/apis/auth.ts
/**
 * Auth ATDD Tests (better-auth HTTP endpoints)
 *
 * Tests the better-auth backed /auth/v1/* endpoints directly via fetch().
 * Follows the same pattern as auth.test.ts but exercises the raw REST API
 * rather than the Sinopebase SDK client.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Sinopebase } from '~/core/app'
import { createClient } from '~/sdk/client'
import { lookupSessionByToken } from '~/tools/auth-better'
import { requirePostgres, reserveLoopbackPort } from '../harness'

const OPAQUE = /^[A-Za-z0-9_-]{43}$/

interface TokenPair {
  access_token: string
  refresh_token: string
  user: { email: string }
}

describe('Auth API (better-auth)', () => {
  let app: Sinopebase
  let baseUrl: string
  const testEmail = `better-auth-test-${Date.now()}@example.com`
  const testPassword = 'test-password-123'
  const supabaseHeaders = {
    'Content-Type': 'application/json',
    apikey: 'test-anon-key',
    Authorization: 'Bearer test-anon-key',
  }

  beforeAll(async () => {
    const portReservation = await reserveLoopbackPort()
    app = new Sinopebase({
      port: portReservation.port,
      postgresUrl: requirePostgres(),
      jwtSecret: 'authbt-jwt-secret-min-32-chars!!!',
      serviceRoleKey: 'authbt-service-key-min-32-chars!!!!',
      anonKey: 'authbt-anon-key-min-32-chars!!!!!!',
    })
    await portReservation.release()
    await app.start()
    baseUrl = portReservation.origin
  })

  afterAll(async () => {
    await app.stop()
  })

  async function signIn(): Promise<TokenPair> {
    const res = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    })
    expect(res.status).toBe(200)
    return (await res.json()) as TokenPair
  }

  function refresh(body: unknown): Promise<Response> {
    return fetch(`${baseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  async function userStatus(accessToken: string): Promise<number> {
    const res = await fetch(`${baseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    return res.status
  }

  function logout(authorization?: string, scope?: string): Promise<Response> {
    return fetch(`${baseUrl}/auth/v1/logout${scope ? `?scope=${scope}` : ''}`, {
      method: 'POST',
      headers: authorization ? { Authorization: authorization } : {},
    })
  }

  // Test 1: Signup
  it('signs up a new user', async () => {
    const res = await fetch(`${baseUrl}/auth/v1/signup`, {
      method: 'POST',
      headers: supabaseHeaders,
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      user: { email: string; id: string }
      access_token: string
      refresh_token: string
      token_type: string
      expires_in: number
    }
    expect(json.user.email).toBe(testEmail)
    expect(json.user.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    expect(json.access_token).toBeTruthy()
    expect(json.refresh_token).toBeTruthy()
    expect(json.token_type).toBe('bearer')
    expect(json.expires_in).toBeGreaterThan(0)
    expect(json).not.toHaveProperty('data')
  })

  // Test 2: Signin with password
  it('signs in with valid password', async () => {
    const res = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: supabaseHeaders,
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { user: { email: string }; access_token: string }
    expect(json.user.email).toBe(testEmail)
    expect(json.access_token).toBeTruthy()
    expect(json).not.toHaveProperty('data')
  })

  it('resolves the actual signed browser cookie through /auth/v1/session', async () => {
    const signIn = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: supabaseHeaders,
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    })
    expect(signIn.status).toBe(200)

    const setCookie = signIn.headers
      .getSetCookie()
      .find((value) => value.startsWith('better-auth.session_token='))
    expect(setCookie).toBeTruthy()
    const cookie = setCookie?.slice(0, setCookie.indexOf(';'))

    // The Set-Cookie value is Better Auth's signed browser representation;
    // it can differ from the database session token returned as access_token.
    const session = await fetch(`${baseUrl}/auth/v1/session`, {
      headers: { ...supabaseHeaders, cookie: cookie ?? '' },
    })
    expect(session.status).toBe(200)
    const body = (await session.json()) as {
      data: { session: { access_token: string; user: { email: string } } | null }
    }
    expect(body.data.session?.user.email).toBe(testEmail)
    expect(body.data.session?.access_token).toBeTruthy()
    const refresh = (body.data.session as unknown as { refresh_token: string }).refresh_token
    expect(refresh).toMatch(OPAQUE)
    expect(refresh).not.toBe(body.data.session?.access_token)
  })

  it('exchanges a validated browser cookie for an authorization-code session', async () => {
    const signIn = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: supabaseHeaders,
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    })
    const setCookie = signIn.headers
      .getSetCookie()
      .find((value) => value.startsWith('better-auth.session_token='))
    expect(setCookie).toBeTruthy()
    const cookie = setCookie?.slice(0, setCookie.indexOf(';')) ?? ''

    const exchange = await fetch(`${baseUrl}/auth/v1/token?grant_type=authorization_code`, {
      method: 'POST',
      headers: { ...supabaseHeaders, cookie },
      body: JSON.stringify({}),
    })

    expect(exchange.status).toBe(200)
    const body = (await exchange.json()) as {
      access_token: string
      refresh_token: string
      user: { email: string }
    }
    expect(body.access_token).toBeTruthy()
    // The refresh token is a separate opaque value (GoTrue contract), not the session token.
    expect(body.refresh_token).toMatch(OPAQUE)
    expect(body.refresh_token).not.toBe(body.access_token)
    expect(body.user.email).toBe(testEmail)
  })

  it('exchanges a validated browser cookie for a Bearer session at /api/auth/exchange', async () => {
    const signIn = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: supabaseHeaders,
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    })
    const setCookie = signIn.headers
      .getSetCookie()
      .find((value) => value.startsWith('better-auth.session_token='))
    const cookie = setCookie?.slice(0, setCookie.indexOf(';')) ?? ''
    const exchange = (headers: Record<string, string>) =>
      fetch(`${baseUrl}/api/auth/exchange`, { method: 'POST', headers })

    const csrf = await exchange({ cookie })
    expect(csrf.status).toBe(403)
    const anonymous = await exchange({ 'x-requested-with': 'sinopebase-admin' })
    expect(anonymous.status).toBe(401)

    const res = await exchange({ cookie, 'x-requested-with': 'sinopebase-admin' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as TokenPair
    expect(body.user.email).toBe(testEmail)
    expect(body.refresh_token).toMatch(OPAQUE)
    expect(body.refresh_token).not.toBe(body.access_token)
    expect((await refresh({ refresh_token: body.refresh_token })).status).toBe(200)
  })

  it('rejects a tampered browser cookie during authorization-code exchange', async () => {
    const exchange = await fetch(`${baseUrl}/auth/v1/token?grant_type=authorization_code`, {
      method: 'POST',
      headers: {
        ...supabaseHeaders,
        cookie: 'better-auth.session_token=not-a-valid-cookie',
      },
      body: JSON.stringify({}),
    })

    expect(exchange.status).toBe(400)
    expect(await exchange.json()).toEqual({
      message: 'Invalid authorization code',
      status: 400,
    })
  })

  it('does not resolve a tampered browser session cookie', async () => {
    const res = await fetch(`${baseUrl}/auth/v1/session`, {
      headers: { ...supabaseHeaders, cookie: 'better-auth.session_token=not-a-valid-cookie' },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { session: unknown; user: unknown } }
    expect(body.data).toEqual({ session: null, user: null })
  })

  it('keeps the built-in Supabase-style SDK compatible with raw GoTrue responses', async () => {
    const client = createClient(baseUrl, 'test-anon-key')
    const response = await client.auth.signInWithPassword({
      email: testEmail,
      password: testPassword,
    })

    expect(response.error).toBeNull()
    expect(response.data.session?.user.email).toBe(testEmail)
    const auth = app.getAuth()
    if (!auth) throw new Error('Expected better-auth to be initialized')
    expect(
      await lookupSessionByToken(auth, response.data.session?.access_token ?? null),
    ).not.toBeNull()
  })

  // Test 3: Get user from token
  it('returns user from valid token', async () => {
    // First sign in to get a token
    const signInRes = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: supabaseHeaders,
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    })
    const signInJson = (await signInRes.json()) as { access_token: string }
    const token = signInJson.access_token

    const res = await fetch(`${baseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { email: string }
    expect(json.email).toBe(testEmail)
    expect(json).not.toHaveProperty('data')
  })

  // Test 4: Reject invalid token
  it('rejects invalid token for user endpoint', async () => {
    const res = await fetch(`${baseUrl}/auth/v1/user`, {
      headers: { Authorization: 'Bearer invalid-token-12345' },
    })
    expect(res.status).toBe(401)
  })

  // Test 5: Reject duplicate email
  it('rejects duplicate email on signup', async () => {
    const res = await fetch(`${baseUrl}/auth/v1/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    })
    expect(res.status).toBe(400)
    const json = (await res.json()) as { message: string }
    expect(json.message).toBeTruthy()
  })

  // Test 6: Reject wrong password
  it('rejects invalid or missing credentials with the GoTrue message', async () => {
    for (const credentials of [
      { email: testEmail, password: 'wrong-password' },
      { email: testEmail },
      { password: testPassword },
    ]) {
      const res = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ message: 'Invalid login credentials', status: 400 })
    }
  })

  // Test 7: Refresh session
  it('issues an opaque refresh token and rotates both tokens on refresh', async () => {
    const session = await signIn()
    expect(session.refresh_token).toMatch(OPAQUE)
    expect(session.refresh_token).not.toBe(session.access_token)

    const res = await refresh({ refresh_token: session.refresh_token })
    expect(res.status).toBe(200)
    const next = (await res.json()) as TokenPair & { token_type: string; expires_in: number }
    expect(next.user.email).toBe(testEmail)
    expect(next.token_type).toBe('bearer')
    expect(next.expires_in).toBe(3600)
    expect(next.access_token).toMatch(OPAQUE)
    expect(next.refresh_token).toMatch(OPAQUE)
    expect(next.access_token).not.toBe(session.access_token)
    expect(next.refresh_token).not.toBe(session.refresh_token)
    expect(await userStatus(next.access_token)).toBe(200)
    expect(await userStatus(session.access_token)).toBe(401)
  })

  it('gives parallel refreshes with the same token the same session (no 400 race)', async () => {
    const session = await signIn()
    const responses = await Promise.all(
      [1, 2, 3].map(() => refresh({ refresh_token: session.refresh_token })),
    )
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200])
    const bodies = (await Promise.all(responses.map((r) => r.json()))) as TokenPair[]
    const pairs = bodies.map((b) => [b.access_token, b.refresh_token])
    expect(pairs[1]).toEqual(pairs[0] as string[])
    expect(pairs[2]).toEqual(pairs[0] as string[])
    expect(await userStatus(bodies[0]?.access_token as string)).toBe(200)
  })

  it('rejects a missing or unknown refresh token', async () => {
    for (const body of [{}, { refresh_token: '' }, { refresh_token: 'unknown-token' }]) {
      const res = await refresh(body)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ message: 'Invalid refresh token', status: 400 })
    }
  })

  // Test 9: Logout
  it('logs out with 204 and revokes the access and refresh tokens', async () => {
    const session = await signIn()
    const res = await logout(`Bearer ${session.access_token}`)
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')

    expect(await userStatus(session.access_token)).toBe(401)
    expect((await refresh({ refresh_token: session.refresh_token })).status).toBe(400)
    const rest = await fetch(`${baseUrl}/rest/v1/_nonexistent`, {
      headers: {
        apikey: 'authbt-anon-key-min-32-chars!!!!!!',
        Authorization: `Bearer ${session.access_token}`,
      },
    })
    expect(rest.status).toBe(401)
  })

  it('logs out every session by default (GoTrue global scope)', async () => {
    const first = await signIn()
    const second = await signIn()
    expect((await logout(`Bearer ${first.access_token}`)).status).toBe(204)
    expect(await userStatus(second.access_token)).toBe(401)
  })

  it('logs out only the current session with scope=local', async () => {
    const first = await signIn()
    const second = await signIn()
    expect((await logout(`Bearer ${first.access_token}`, 'local')).status).toBe(204)
    expect(await userStatus(first.access_token)).toBe(401)
    expect(await userStatus(second.access_token)).toBe(200)
  })

  it('logs out the other sessions with scope=others', async () => {
    const first = await signIn()
    const second = await signIn()
    expect((await logout(`Bearer ${first.access_token}`, 'others')).status).toBe(204)
    expect(await userStatus(first.access_token)).toBe(200)
    expect(await userStatus(second.access_token)).toBe(401)
  })

  it('rejects logout without a Bearer token (401) or without a live session (403)', async () => {
    const session = await signIn()
    for (const authorization of [undefined, `Token: ${session.access_token}`, 'Bearer ']) {
      const res = await logout(authorization)
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({
        message: 'This endpoint requires a valid Bearer token',
        status: 401,
      })
    }
    const unknown = await logout('Bearer revoked-or-unknown')
    expect(unknown.status).toBe(403)
    expect(await unknown.json()).toEqual({ message: 'Session not found', status: 403 })
    expect(await userStatus(session.access_token)).toBe(200)

    expect((await logout(`Bearer ${session.access_token}`)).status).toBe(204)
    expect((await logout(`Bearer ${session.access_token}`)).status).toBe(403)
  })

  it('rejects an unsupported logout scope', async () => {
    const session = await signIn()
    const res = await logout(`Bearer ${session.access_token}`, 'everyone')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ message: 'Unsupported logout scope', status: 400 })
    expect(await userStatus(session.access_token)).toBe(200)
  })

  it('rejects signup while signups are closed', async () => {
    const original = process.env.ALLOW_SIGNUPS
    process.env.ALLOW_SIGNUPS = 'false'
    try {
      const res = await fetch(`${baseUrl}/auth/v1/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `closed-${testEmail}`, password: testPassword }),
      })
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({
        message: 'Signups are currently invite-only.',
        status: 403,
      })
    } finally {
      if (original === undefined) delete process.env.ALLOW_SIGNUPS
      else process.env.ALLOW_SIGNUPS = original
    }
  })

  // Test 8: Reject missing email
  it('rejects signup without email', async () => {
    const res = await fetch(`${baseUrl}/auth/v1/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'password123' }),
    })
    expect(res.status).toBe(400)
  })

  // Test 10: Reject unknown grant type
  it('rejects unknown grant type', async () => {
    for (const query of ['?grant_type=invalid', '?grant_type=constructor', '']) {
      const res = await fetch(`${baseUrl}/auth/v1/token${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ message: 'Invalid grant type', status: 400 })
    }
  })
})
