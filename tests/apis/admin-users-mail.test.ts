/**
 * Failure paths of the service-only user routes that a live database and SMTP sink cannot
 * produce on demand: an unreadable identity store and a mailer that throws. Neither may leak
 * the underlying error, and neither may report a send.
 *
 * @new-code-test positive src/apis/admin-users.ts
 * @new-code-test negative src/apis/admin-users.ts
 */

import { describe, expect, test } from 'bun:test'
import type { Kysely } from 'kysely'
import { createAdminUsersPlugin, type DeliverMail } from '~/apis/admin-users'
import type { BetterAuthDatabase } from '~/tools/auth-better/adapter'

const serviceKey = 'admin-users-unit-service-key-at-least-32-chars'
const USER = '6c303797-acc4-486a-9770-42a1e2d288ff'
const notice = { subject: 'Overdue requests', text: 'Open your agent or Sinope.' }

/** A database whose every query fails, with a message that must never reach the caller. */
const unreachable = new Proxy(
  {},
  {
    get() {
      throw new Error('connect ECONNREFUSED secret@db')
    },
  },
) as Kysely<BetterAuthDatabase>

/** A database that knows one user's address: it answers every raw query with that row. */
const knowsOne = {
  getExecutor: () => ({
    transformQuery: (node: unknown) => node,
    compileQuery: (node: unknown) => ({ query: node, sql: '', parameters: [] }),
    executeQuery: async () => ({ rows: [{ email: 'owner@example.com' }] }),
  }),
} as unknown as Kysely<BetterAuthDatabase>

function call(
  app: ReturnType<typeof createAdminUsersPlugin>,
  path: string,
  body: unknown,
  token?: string,
) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  )
}

describe('provisioning', () => {
  const app = createAdminUsersPlugin(unreachable, serviceKey)

  test('refuses without the service key or a valid body', async () => {
    const credentials = { email: 'new@example.com', password: 'a-long-enough-password' }
    expect((await call(app, '/auth/v1/admin/users', credentials)).status).toBe(403)
    expect(
      (
        await call(
          createAdminUsersPlugin(unreachable, undefined),
          '/auth/v1/admin/users',
          credentials,
          serviceKey,
        )
      ).status,
    ).toBe(403)
    const invalid = await call(
      app,
      '/auth/v1/admin/users',
      { email: 'x', password: 'short' },
      serviceKey,
    )
    expect(invalid.status).toBe(400)
  })

  test('reports an unconfirmed creation without the driver error', async () => {
    const failed = await call(
      app,
      '/auth/v1/admin/users',
      { email: 'new@example.com', password: 'a-long-enough-password' },
      serviceKey,
    )
    expect(failed.status).toBe(503)
    expect(await failed.text()).not.toContain('secret')
  })
})

describe('notice', () => {
  test('sends to the address on record and reports it sent', async () => {
    const sent: Parameters<DeliverMail>[0][] = []
    const app = createAdminUsersPlugin(knowsOne, serviceKey, async (mail) => {
      sent.push(mail)
      return true
    })
    const response = await call(app, `/auth/v1/admin/users/${USER}/mail`, notice, serviceKey)
    expect(response.status).toBe(202)
    expect(sent).toEqual([{ to: 'owner@example.com', ...notice }])
  })

  test('an unreadable user store refuses without the driver error', async () => {
    const app = createAdminUsersPlugin(unreachable, serviceKey, async () => true)
    const response = await call(app, `/auth/v1/admin/users/${USER}/mail`, notice, serviceKey)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ message: 'The user could not be read.' })
  })

  test('a mailer that throws or declines never reports a send', async () => {
    const throws = createAdminUsersPlugin(knowsOne, serviceKey, async () => {
      throw new Error('550 owner@example.com rejected')
    })
    const failed = await call(throws, `/auth/v1/admin/users/${USER}/mail`, notice, serviceKey)
    expect(failed.status).toBe(502)
    expect(await failed.text()).not.toContain('owner@example.com')
    const declines = createAdminUsersPlugin(knowsOne, serviceKey, async () => false)
    expect(
      (await call(declines, `/auth/v1/admin/users/${USER}/mail`, notice, serviceKey)).status,
    ).toBe(503)
  })
})
