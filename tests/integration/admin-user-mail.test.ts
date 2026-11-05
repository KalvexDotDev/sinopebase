/**
 * Service-only notice to one registered user by id (sinope#1104 overdue nudges), over real
 * HTTP. Requires PostgreSQL (TEST_POSTGRES_URL). The delivery suite also requires the `mail`
 * service from docker-compose.yml (Mailpit) and skips when it is unreachable, mirroring
 * tests/integration/auth-recovery.test.ts.
 *
 * @new-code-test positive src/apis/admin-users.ts
 * @new-code-test negative src/apis/admin-users.ts
 * @new-code-test positive src/apis/auth.ts
 * @new-code-test negative src/apis/auth.ts
 * @new-code-test positive src/core/app.ts
 * @new-code-test negative src/core/app.ts
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import pg from 'pg'
import { Sinopebase } from '~/core/app'
import { requirePostgres, reserveLoopbackPort } from '../harness'

const MAILPIT_API = process.env.TEST_MAILPIT_API_URL ?? 'http://localhost:8025/api/v1'
const serviceKey = 'user-mail-test-service-key-at-least-32-chars'
const run = crypto.randomUUID().slice(0, 8)
const SMTP = {
  enabled: true,
  host: process.env.TEST_SMTP_HOST ?? 'localhost',
  port: Number(process.env.TEST_SMTP_PORT ?? 1025),
  fromAddress: 'noreply@mail.sinopebase.test',
  fromName: 'Sinopebase Test',
}
const notice = { subject: `Overdue requests ${run}`, text: 'Open your agent or Sinope.' }

async function mailpitAvailable(): Promise<boolean> {
  try {
    return (await fetch(`${MAILPIT_API}/messages`, { signal: AbortSignal.timeout(1500) })).ok
  } catch {
    return false
  }
}
const mailpitUp = await mailpitAvailable()

let pool: pg.Pool
beforeAll(async () => {
  pool = new pg.Pool({ connectionString: requirePostgres() })
  await pool.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS better_auth_user_email_unique ON public."user" (lower(email))',
  )
})
afterAll(async () => {
  await pool?.end()
})

async function startApp(smtp?: typeof SMTP) {
  const port = await reserveLoopbackPort()
  const app = new Sinopebase({
    port: port.port,
    postgresUrl: requirePostgres(),
    jwtSecret: 'user-mail-test-jwt-secret-at-least-32-chars',
    serviceRoleKey: serviceKey,
    anonKey: 'user-mail-test-anon-key-at-least-32-chars',
    ...(smtp ? { smtp } : {}),
  })
  await port.release()
  await app.start()
  return { app, origin: port.origin }
}

function post(origin: string, path: string, body: unknown, token?: string) {
  return fetch(`${origin}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

async function provision(origin: string, label: string) {
  const email = `${label}-${run}@example.com`
  const created = await post(
    origin,
    '/auth/v1/admin/users',
    { email, password: `Mail-test-${crypto.randomUUID()}` },
    serviceKey,
  )
  expect(created.status).toBe(201)
  return { email, id: ((await created.json()) as { user: { id: string } }).user.id }
}

describe('without SMTP', () => {
  let app: Sinopebase
  let origin: string
  beforeAll(async () => {
    ;({ app, origin } = await startApp())
  })
  afterAll(async () => {
    await app?.stop()
  })

  test('only the service key may send, to a registered user, in plain bounded text', async () => {
    const user = await provision(origin, 'no-smtp')
    const path = `/auth/v1/admin/users/${user.id}/mail`
    for (const token of [undefined, 'user-mail-test-anon-key-at-least-32-chars', 'forged']) {
      const denied = await post(origin, path, notice, token)
      expect(denied.status).toBe(403)
      expect(await denied.json()).toEqual({ message: 'Service authorization required.' })
    }
    for (const body of [
      { ...notice, to: 'someone@example.com' },
      { ...notice, html: '<b>x</b>' },
      { subject: '', text: 'x' },
      { subject: 'x'.repeat(201), text: 'x' },
      { subject: 'x', text: 'x'.repeat(5001) },
    ]) {
      expect((await post(origin, path, body, serviceKey)).status).toBe(400)
    }
    const unknown = await post(
      origin,
      `/auth/v1/admin/users/${crypto.randomUUID()}/mail`,
      notice,
      serviceKey,
    )
    expect(unknown.status).toBe(404)
  })

  test('an unconfigured mailer refuses instead of reporting a send', async () => {
    const user = await provision(origin, 'unconfigured')
    const refused = await post(origin, `/auth/v1/admin/users/${user.id}/mail`, notice, serviceKey)
    expect(refused.status).toBe(503)
    expect(await refused.json()).toEqual({ message: 'Mail is not configured.' })
  })
})

describe.skipIf(!mailpitUp)('with SMTP (Mailpit)', () => {
  let app: Sinopebase
  let origin: string
  const recipients: string[] = []
  beforeAll(async () => {
    ;({ app, origin } = await startApp(SMTP))
  })
  afterAll(async () => {
    await app?.stop()
    for (const recipient of recipients) {
      const query = encodeURIComponent(`to:"${recipient}"`)
      await fetch(`${MAILPIT_API}/search?query=${query}`, { method: 'DELETE' })
    }
  })

  test('the notice reaches the address the user signs in with, and only them', async () => {
    const user = await provision(origin, 'nudged')
    const other = await provision(origin, 'bystander')
    recipients.push(user.email, other.email)
    const sent = await post(origin, `/auth/v1/admin/users/${user.id}/mail`, notice, serviceKey)
    expect(sent.status).toBe(202)
    expect(await sent.json()).toEqual({ sent: true })
    let messages: { ID: string; Subject: string; To: { Address: string }[] }[] = []
    for (let attempt = 0; attempt < 40 && messages.length === 0; attempt++) {
      // Mailpit is an external SMTP sink; delivery is observable only by polling.
      await Bun.sleep(250)
      const query = encodeURIComponent(`subject:"${notice.subject}"`)
      messages = (
        (await (await fetch(`${MAILPIT_API}/search?query=${query}`)).json()) as {
          messages: typeof messages
        }
      ).messages
    }
    expect(messages.map((m) => m.To.map((to) => to.Address))).toEqual([[user.email]])
    const [message] = messages
    if (!message) throw new Error('Mailpit message not found')
    const detail = (await (await fetch(`${MAILPIT_API}/message/${message.ID}`)).json()) as {
      Text: string
      From: { Address: string }
    }
    expect(detail.Text.trim()).toBe(notice.text)
    expect(detail.From.Address).toBe(SMTP.fromAddress)
  })
})
