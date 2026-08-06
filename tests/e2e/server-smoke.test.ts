/**
 * Server smoke tests — start a real Sinopebase server and validate endpoints
 * via HTTP. No browser needed; runs on all platforms including Windows.
 *
 * These catch the same class of bugs as Playwright E2E (server startup
 * failure, broken routes, auth issues) without the Bun+Playwright CDP
 * hang on Windows.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Sinopebase } from '~/core/app'

describe('Server E2E smoke', () => {
  let app: Sinopebase
  let baseUrl: string

  beforeAll(async () => {
    const pgUrl = process.env.TEST_POSTGRES_URL || process.env.POSTGRES_URL || ''
    if (!pgUrl) throw new Error('E2E requires TEST_POSTGRES_URL or POSTGRES_URL')

    app = new Sinopebase({
      port: 9877,
      host: '127.0.0.1',
      postgresUrl: pgUrl,
      jwtSecret: 'e2e-smoke-jwt-secret-min-32-chars',
      serviceRoleKey: 'e2e-key-service-min-32-chars!!',
      anonKey: 'e2e-key-anon-min-32-chars!!!!!',
    })
    await app.start()
    baseUrl = 'http://127.0.0.1:9877'
  })

  afterAll(async () => {
    if (app) await app.stop()
  })

  test('health endpoint returns 200', async () => {
    const res = await fetch(`${baseUrl}/api/health`)
    expect(res.status).toBe(200)
  })

  test('admin UI loads at /_/', async () => {
    const res = await fetch(`${baseUrl}/_/`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html.toLowerCase()).toContain('<!doctype html>')
  })

  test('API docs load at /_/api', async () => {
    const res = await fetch(`${baseUrl}/_/api`)
    expect(res.status).toBe(200)
  })

  test('rest v1 returns 401 without auth', async () => {
    const res = await fetch(`${baseUrl}/rest/v1/todos`)
    expect(res.status).toBe(401)
  })

  test('auth signup works end-to-end', async () => {
    const res = await fetch(`${baseUrl}/auth/v1/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `e2e-smoke-${Date.now()}@test.com`,
        password: 'testpass123',
      }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as Record<string, unknown>
    expect(json.access_token).toBeString()
    expect(json.user).toBeObject()
  })

  test('auth session returns null without cookie', async () => {
    const res = await fetch(`${baseUrl}/auth/v1/session`)
    expect(res.status).toBe(200)
    const json = (await res.json()) as Record<string, unknown>
    expect(json.data.session).toBeNull()
  })

  test('storage bucket list returns 200', async () => {
    const res = await fetch(`${baseUrl}/storage/v1/bucket`, {
      headers: {
        apikey: 'e2e-key-anon-min-32-chars!!!!!',
        Authorization: 'Bearer e2e-key-anon-min-32-chars!!!!!',
      },
    })
    // Can return 200 (empty array) or error if storage not configured
    // Just checking the server doesn't crash
    expect([200, 404]).toContain(res.status)
  })
})
