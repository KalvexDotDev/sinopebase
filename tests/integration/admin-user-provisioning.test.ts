import { afterAll, beforeAll, expect, test } from 'bun:test'
import pg from 'pg'
import { Sinopebase } from '~/core/app'
import { requirePostgres, reserveLoopbackPort } from '../harness'

const serviceKey = 'provisioning-test-service-key-at-least-32-chars'
const password = 'Provisioning-test-password-123!'
const email = `provision-${crypto.randomUUID()}@example.com`
let app: Sinopebase
let origin: string
let pool: pg.Pool
const previousPolicy = process.env.ALLOW_SIGNUPS

beforeAll(async () => {
  process.env.ALLOW_SIGNUPS = 'false'
  pool = new pg.Pool({ connectionString: requirePostgres() })
  const port = await reserveLoopbackPort()
  app = new Sinopebase({
    port: port.port,
    postgresUrl: requirePostgres(),
    jwtSecret: 'provisioning-test-jwt-secret-at-least-32-chars',
    serviceRoleKey: serviceKey,
    anonKey: 'provisioning-test-anon-key-at-least-32-chars',
  })
  await port.release()
  await app.start()
  origin = port.origin
  // Deployment administrator installs this before enabling runtime provisioning.
  await pool.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS better_auth_user_email_unique ON public."user" (lower(email))',
  )
})
afterAll(async () => {
  await app?.stop()
  await pool?.end()
  if (previousPolicy === undefined) delete process.env.ALLOW_SIGNUPS
  else process.env.ALLOW_SIGNUPS = previousPolicy
})
function post(path: string, body: unknown, token?: string) {
  return fetch(`${origin}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

test('closed public signup still permits service-authorized ordinary-user provisioning and login', async () => {
  for (const path of ['/auth/v1/signup', '/api/auth/sign-up/email']) {
    expect((await post(path, { email, password, name: 'Test' })).status).toBe(403)
  }
  for (const token of [undefined, 'provisioning-test-anon-key-at-least-32-chars', 'forged']) {
    expect((await post('/auth/v1/admin/users', { email, password }, token)).status).toBe(403)
  }
  expect(
    (await post('/auth/v1/admin/users', { email, password, role: 'admin' }, serviceKey)).status,
  ).toBe(400)
  const created = await post('/auth/v1/admin/users', { email, password }, serviceKey)
  expect(created.status).toBe(201)
  expect(created.headers.get('set-cookie')).toBeNull()
  const body = (await created.json()) as { user: { id: string; email: string } }
  expect(body).toEqual({ user: { id: expect.any(String), email } })
  const rows = await pool.query('SELECT role, "emailVerified" FROM public."user" WHERE id = $1', [
    body.user.id,
  ])
  expect(rows.rows).toEqual([{ role: 'user', emailVerified: false }])
  const sessions = await pool.query('SELECT id FROM public.session WHERE "userId" = $1', [
    body.user.id,
  ])
  expect(sessions.rowCount).toBe(0)
  expect(
    (await post('/auth/v1/admin/users', { email, password: 'Different-password-123!' }, serviceKey))
      .status,
  ).toBe(409)
  const login = await post('/auth/v1/token?grant_type=password', { email, password })
  expect(login.status).toBe(200)
  const signedIn = (await login.json()) as { access_token: string; user: { id: string } }
  expect(signedIn.user.id).toBe(body.user.id)
  expect(
    (
      await post(
        '/auth/v1/admin/users',
        { email: `other-${email}`, password },
        signedIn.access_token,
      )
    ).status,
  ).toBe(403)
  expect((await post('/auth/v1/signup', { email: `public-${email}`, password })).status).toBe(403)
})

test('concurrent public signup and provisioning cannot create duplicate identities', async () => {
  process.env.ALLOW_SIGNUPS = 'true'
  const raceEmail = `race-${crypto.randomUUID()}@example.com`
  try {
    const responses = await Promise.all([
      post('/auth/v1/signup', { email: raceEmail, password }),
      post('/auth/v1/admin/users', { email: raceEmail.toUpperCase(), password }, serviceKey),
    ])
    expect(responses.filter((response) => response.ok)).toHaveLength(1)
    const count = await pool.query(
      'SELECT count(*)::int AS n FROM public."user" WHERE lower(email) = $1',
      [raceEmail],
    )
    expect(count.rows[0].n).toBe(1)
    expect(
      (await post('/auth/v1/token?grant_type=password', { email: raceEmail, password })).status,
    ).toBe(200)
  } finally {
    process.env.ALLOW_SIGNUPS = 'false'
  }
})

test('provisioning fails closed before the owner has installed the identity migration', async () => {
  const blockedEmail = `missing-migration-${crypto.randomUUID()}@example.com`
  await pool.query('DROP INDEX public.better_auth_user_email_unique')
  try {
    expect(
      (await post('/auth/v1/admin/users', { email: blockedEmail, password }, serviceKey)).status,
    ).toBe(503)
    const result = await pool.query('SELECT id FROM public."user" WHERE email = $1', [blockedEmail])
    expect(result.rowCount).toBe(0)
  } finally {
    await pool.query(
      'CREATE UNIQUE INDEX better_auth_user_email_unique ON public."user" (lower(email))',
    )
  }
})
