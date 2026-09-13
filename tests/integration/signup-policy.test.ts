import { afterAll, beforeAll, expect, test } from 'bun:test'
import { Pool } from 'pg'
import { Sinopebase } from '~/core/app'
import { createAuth } from '~/tools/auth-better'
import { requirePostgres, reserveLoopbackPort } from '../harness'

let app: Sinopebase
let origin: string
beforeAll(async () => {
  const port = await reserveLoopbackPort()
  app = new Sinopebase({ port: port.port, postgresUrl: requirePostgres() })
  await port.release()
  await app.start()
  origin = port.origin
})
afterAll(async () => {
  await app?.stop()
})

test('closing registration also blocks native signup without blocking existing-user login', async () => {
  const previous = process.env.ALLOW_SIGNUPS
  const email = `signup-policy-${crypto.randomUUID()}@example.com`
  const password = crypto.randomUUID()
  const post = (path: string, body: Record<string, string>) =>
    fetch(origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  try {
    process.env.ALLOW_SIGNUPS = 'true'
    const created = await post('/api/auth/sign-up/email', {
      email,
      password,
      name: 'Policy fixture',
    })
    expect(created.status).toBe(200)
    await created.body?.cancel()
    process.env.ALLOW_SIGNUPS = 'false'
    for (const path of ['/auth/v1/signup', '/api/auth/sign-up/email']) {
      const denied = await post(path, {
        email: `denied-${crypto.randomUUID()}@example.com`,
        password,
        name: 'Denied fixture',
      })
      expect(denied.status).toBe(403)
      expect(denied.headers.get('set-cookie')).toBeNull()
      const body = (await denied.json()) as Record<string, unknown>
      expect(body.token).toBeUndefined()
      expect(body.access_token).toBeUndefined()
    }
    const signedIn = await post('/api/auth/sign-in/email', { email, password })
    expect(signedIn.status).toBe(200)
    await signedIn.body?.cancel()
  } finally {
    if (previous === undefined) delete process.env.ALLOW_SIGNUPS
    else process.env.ALLOW_SIGNUPS = previous
    const pool = new Pool({ connectionString: requirePostgres() })
    try {
      // Session and account foreign keys cascade for this fixture only.
      await pool.query('DELETE FROM "user" WHERE email = $1', [email])
    } finally {
      await pool.end()
    }
  }
})

test('registration policy rejects OAuth auto-provisioning before user or account persistence', async () => {
  const previousSignup = process.env.ALLOW_SIGNUPS
  const previousProduction = process.env.SINOPEBASE_PRODUCTION
  const pool = new Pool({ connectionString: requirePostgres() })
  try {
    const auth = await createAuth(pool)
    const { internalAdapter } = await auth.$context
    for (const mode of ['closed', 'production-default']) {
      if (mode === 'closed') process.env.ALLOW_SIGNUPS = 'false'
      else {
        delete process.env.ALLOW_SIGNUPS
        process.env.SINOPEBASE_PRODUCTION = 'true'
      }
      const email = `oauth-policy-${crypto.randomUUID()}@example.com`
      await expect(
        internalAdapter.createOAuthUser(
          { email, name: 'OAuth fixture', emailVerified: true },
          { providerId: 'google', accountId: crypto.randomUUID() },
        ),
      ).rejects.toMatchObject({ status: 'FORBIDDEN' })
      const rows = await pool.query('SELECT id FROM "user" WHERE email = $1', [email])
      expect(rows.rowCount).toBe(0)
    }
  } finally {
    if (previousSignup === undefined) delete process.env.ALLOW_SIGNUPS
    else process.env.ALLOW_SIGNUPS = previousSignup
    if (previousProduction === undefined) delete process.env.SINOPEBASE_PRODUCTION
    else process.env.SINOPEBASE_PRODUCTION = previousProduction
    await pool.end()
  }
})
