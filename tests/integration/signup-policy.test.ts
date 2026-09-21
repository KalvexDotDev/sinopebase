import { afterAll, beforeAll, expect, test } from 'bun:test'
import { Pool } from 'pg'
import { Sinopebase } from '~/core/app'
import { createAuth } from '~/tools/auth-better'
import { signupsAllowed } from '~/tools/auth-better/signup-policy'
import { requirePostgres, reserveLoopbackPort } from '../harness'

let app: Sinopebase
let origin: string
beforeAll(async () => {
  const port = await reserveLoopbackPort()
  app = new Sinopebase({
    port: port.port,
    postgresUrl: requirePostgres(),
    // Other app fixtures publish their development keys to process.env.
    // Pin valid production-compatible fixture keys rather than inherit them.
    serviceRoleKey: crypto.randomUUID() + crypto.randomUUID(),
    anonKey: crypto.randomUUID() + crypto.randomUUID(),
    jwtSecret: crypto.randomUUID() + crypto.randomUUID(),
  })
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
      expect(body.message).toBe('Signups are currently invite-only.')
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
      ).rejects.toMatchObject({
        status: 'FORBIDDEN',
        body: { message: 'Signups are currently invite-only.' },
      })
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

// @new-code-test positive src/apis/auth.ts
// @new-code-test negative src/apis/auth.ts
// @new-code-test positive src/tools/auth-better/index.ts
// @new-code-test negative src/tools/auth-better/index.ts
// @new-code-test positive src/tools/auth-better/signup-policy.ts
// @new-code-test negative src/tools/auth-better/signup-policy.ts

test.each([
  ['true', undefined, false],
  ['true', 'false', false],
  ['true', 'true', true],
  [undefined, undefined, true],
  [undefined, 'false', false],
  [undefined, 'true', true],
  ['false', undefined, true],
  ['false', 'false', false],
  ['false', 'true', true],
] as const)(
  'registration policy production=%s explicit=%s allows=%s',
  (production, signup, expected) => {
    const oldProduction = process.env.SINOPEBASE_PRODUCTION
    const oldSignup = process.env.ALLOW_SIGNUPS
    try {
      if (production === undefined) delete process.env.SINOPEBASE_PRODUCTION
      else process.env.SINOPEBASE_PRODUCTION = production
      if (signup === undefined) delete process.env.ALLOW_SIGNUPS
      else process.env.ALLOW_SIGNUPS = signup
      expect(signupsAllowed()).toBe(expected)
    } finally {
      if (oldProduction === undefined) delete process.env.SINOPEBASE_PRODUCTION
      else process.env.SINOPEBASE_PRODUCTION = oldProduction
      if (oldSignup === undefined) delete process.env.ALLOW_SIGNUPS
      else process.env.ALLOW_SIGNUPS = oldSignup
    }
  },
)
