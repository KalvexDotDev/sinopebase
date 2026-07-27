/**
 * Auth ATDD Tests
 *
 * Ported from supabase-js test/integration.test.ts (Auth block).
 * These drive implementation of better-auth backed /auth/v1 endpoints.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Sinopebase } from '../../src/core/app'
import { createClient, type SinopebaseClient } from '../../src/sdk/client'
import { requireAnonKey, requirePostgres, reserveLoopbackPort } from '../harness'
import { uniqueEmail } from './setup'

let client: SinopebaseClient
let server: Sinopebase

beforeAll(async () => {
  const portReservation = await reserveLoopbackPort()
  // Start the Sinopebase server for integration testing with validated credentials
  server = new Sinopebase({
    postgresUrl: requirePostgres(),
    port: portReservation.port,
  })
  await portReservation.release()
  await server.start()
  client = createClient(portReservation.origin, requireAnonKey())
})

afterAll(async () => {
  await server.stop()
})

describe('Auth', () => {
  const testEmail = uniqueEmail()
  const testPassword = 'test-password-123!'

  it('signUp() — creates a new user', async () => {
    const { data, error } = await client.auth.signUp({
      email: testEmail,
      password: testPassword,
    })

    expect(error).toBeNull()
    expect(data.user).not.toBeNull()
    expect(data.user?.email).toBe(testEmail)
    expect(data.user?.id).toBeTruthy()
    expect(data.session).not.toBeNull()
    expect(data.session?.access_token).toBeTruthy()
    expect(data.session?.refresh_token).toBeTruthy()
    expect(data.session?.token_type).toBe('bearer')
    expect(data.session?.expires_in).toBeGreaterThan(0)
  })

  it('signInWithPassword() — authenticates existing user', async () => {
    const { data, error } = await client.auth.signInWithPassword({
      email: testEmail,
      password: testPassword,
    })

    expect(error).toBeNull()
    expect(data.user).not.toBeNull()
    expect(data.user?.email).toBe(testEmail)
    expect(data.session).not.toBeNull()
  })

  it('getUser() — returns current user with valid session', async () => {
    // Sign in to get a valid session
    await client.auth.signInWithPassword({
      email: testEmail,
      password: testPassword,
    })

    const { data, error } = await client.auth.getUser()

    expect(error).toBeNull()
    expect(data.user).not.toBeNull()
    expect(data.user?.email).toBe(testEmail)
  })

  it('signInWithPassword() — rejects invalid credentials', async () => {
    const { data, error } = await client.auth.signInWithPassword({
      email: testEmail,
      password: 'wrong-password',
    })

    expect(error).not.toBeNull()
    expect(data.user).toBeNull()
    expect(data.session).toBeNull()
  })

  it('signInWithPassword() — rejects non-existent user', async () => {
    const { data, error } = await client.auth.signInWithPassword({
      email: 'nobody@nonexistent.example.com',
      password: 'anything',
    })

    expect(error).not.toBeNull()
    expect(data.user).toBeNull()
  })

  it('signOut() — ends the session', async () => {
    // Sign in first
    await client.auth.signInWithPassword({
      email: testEmail,
      password: testPassword,
    })

    const { error } = await client.auth.signOut()
    expect(error).toBeNull()

    // getUser should fail after signout
    const { data } = await client.auth.getUser()
    expect(data.user).toBeNull()
  })

  it('refreshSession() — refreshes tokens', async () => {
    // Sign in to get refresh token
    const { data: signInData } = await client.auth.signInWithPassword({
      email: testEmail,
      password: testPassword,
    })

    const oldToken = signInData.session?.access_token

    const { data, error } = await client.auth.refreshSession()

    expect(error).toBeNull()
    expect(data.session).not.toBeNull()
    // New token should differ from old
    expect(data.session?.access_token).not.toBe(oldToken)
  })
})
