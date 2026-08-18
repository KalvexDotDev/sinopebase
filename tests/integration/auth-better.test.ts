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
    expect(body.refresh_token).toBe(body.access_token)
    expect(body.user.email).toBe(testEmail)
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
  it('rejects invalid password on signin', async () => {
    const res = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: 'wrong-password' }),
    })
    expect(res.status).toBe(400)
    const json = (await res.json()) as { message: string }
    expect(json.message).toBeTruthy()
  })

  // Test 7: Refresh session
  it('refreshes session with refresh token', async () => {
    const signInRes = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    })
    const signInJson = (await signInRes.json()) as { refresh_token: string }
    const refreshToken = signInJson.refresh_token

    const res = await fetch(`${baseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { access_token: string }
    expect(json.access_token).toBeTruthy()
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

  // Test 9: Logout
  it('logs out successfully', async () => {
    const signInRes = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    })
    const signInJson = (await signInRes.json()) as { access_token: string }
    const token = signInJson.access_token

    const res = await fetch(`${baseUrl}/auth/v1/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as Record<string, unknown>
    expect(json).toEqual({})
  })

  // Test 10: Reject unknown grant type
  it('rejects unknown grant type', async () => {
    const res = await fetch(`${baseUrl}/auth/v1/token?grant_type=invalid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })
})
