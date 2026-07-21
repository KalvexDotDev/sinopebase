/**
 * Auth ATDD Tests (better-auth HTTP endpoints)
 *
 * Tests the better-auth backed /auth/v1/* endpoints directly via fetch().
 * Follows the same pattern as auth.test.ts but exercises the raw REST API
 * rather than the Sinopebase SDK client.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { Sinopebase } from '~/core/app'

describe('Auth API (better-auth)', () => {
  let app: Sinopebase
  let baseUrl: string
  const testEmail = 'better-auth-test-' + Date.now() + '@example.com'
  const testPassword = 'test-password-123'

  beforeAll(async () => {
    app = new Sinopebase({
      port: 8091,
      postgresUrl: process.env.TEST_POSTGRES_URL || '',
    })
    await app.start()
    baseUrl = 'http://127.0.0.1:8091'
  })

  afterAll(async () => {
    await app.stop()
  })

  // Test 1: Signup
  it('signs up a new user', async () => {
    const res = await fetch(baseUrl + '/auth/v1/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword })
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.user.email).toBe(testEmail)
    expect(json.data.session.access_token).toBeTruthy()
    expect(json.data.session.refresh_token).toBeTruthy()
    expect(json.data.session.token_type).toBe('bearer')
    expect(json.data.session.expires_in).toBeGreaterThan(0)
    expect(json.error).toBeNull()
  })

  // Test 2: Signin with password
  it('signs in with valid password', async () => {
    const res = await fetch(baseUrl + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword })
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.user.email).toBe(testEmail)
    expect(json.data.session.access_token).toBeTruthy()
    expect(json.error).toBeNull()
  })

  // Test 3: Get user from token
  it('returns user from valid token', async () => {
    // First sign in to get a token
    const signInRes = await fetch(baseUrl + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword })
    })
    const signInJson = await signInRes.json()
    const token = signInJson.data.session.access_token

    const res = await fetch(baseUrl + '/auth/v1/user', {
      headers: { Authorization: 'Bearer ' + token }
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.user.email).toBe(testEmail)
    expect(json.error).toBeNull()
  })

  // Test 4: Reject invalid token
  it('rejects invalid token for user endpoint', async () => {
    const res = await fetch(baseUrl + '/auth/v1/user', {
      headers: { Authorization: 'Bearer invalid-token-12345' }
    })
    expect(res.status).toBe(401)
  })

  // Test 5: Reject duplicate email
  it('rejects duplicate email on signup', async () => {
    const res = await fetch(baseUrl + '/auth/v1/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword })
    })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBeTruthy()
  })

  // Test 6: Reject wrong password
  it('rejects invalid password on signin', async () => {
    const res = await fetch(baseUrl + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: 'wrong-password' })
    })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBeTruthy()
  })

  // Test 7: Refresh session
  it('refreshes session with refresh token', async () => {
    const signInRes = await fetch(baseUrl + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword })
    })
    const signInJson = await signInRes.json()
    const refreshToken = signInJson.data.session.refresh_token

    const res = await fetch(baseUrl + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken })
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.session.access_token).toBeTruthy()
    expect(json.error).toBeNull()
  })

  // Test 8: Reject missing email
  it('rejects signup without email', async () => {
    const res = await fetch(baseUrl + '/auth/v1/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'password123' })
    })
    expect(res.status).toBe(400)
  })

  // Test 9: Logout
  it('logs out successfully', async () => {
    const signInRes = await fetch(baseUrl + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword })
    })
    const signInJson = await signInRes.json()
    const token = signInJson.data.session.access_token

    const res = await fetch(baseUrl + '/auth/v1/logout', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token }
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.error).toBeNull()
  })

  // Test 10: Reject unknown grant type
  it('rejects unknown grant type', async () => {
    const res = await fetch(baseUrl + '/auth/v1/token?grant_type=invalid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })
    expect(res.status).toBe(400)
  })
})
