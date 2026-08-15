/**
 * Password recovery ATDD — reset and email-verification e2e over real HTTP
 * routes (better-auth behind /api/auth/*, Supabase-compatible /auth/v1/*),
 * plus the no-SMTP fallback contract (anti-enumeration, mailer no-op).
 *
 * Requires PostgreSQL (TEST_POSTGRES_URL). The e2e suites also require the
 * `mail` service from docker-compose.yml (SMTP localhost:1025, API
 * http://localhost:8025/api/v1) and skip when Mailpit is unreachable,
 * mirroring tests/integration/mailer.test.ts.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Pool } from 'pg'
import { Sinopebase } from '~/core/app'
import { createClient } from '~/sdk/client'
import { requirePostgres, reserveLoopbackPort } from '../harness'

const MAILPIT_API = 'http://localhost:8025/api/v1'
const RESET_SUBJECT = 'Sinopebase password reset'
const VERIFY_SUBJECT = 'Verify your email'
const ANON_KEY = 'auth-recovery-anon-key-min-32-chars!!'
const JWT_SECRET = 'auth-recovery-jwt-secret-min-32-char!'
const SERVICE_KEY = 'auth-recovery-service-key-min-32-chars'

interface MailpitMessage {
  ID: string
  Subject: string
  To: { Name: string; Address: string }[]
}

interface MailpitDetail {
  Text: string
  HTML: string
}

async function mailpitAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${MAILPIT_API}/messages`, { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch {
    return false
  }
}

const mailpitUp = await mailpitAvailable()

/**
 * Poll Mailpit until a message with the given subject arrives for the
 * recipient, record its ID for assertions, and return its text+html body.
 * ponytail: match by subject + recipient; the per-run address makes
 * collisions impossible.
 */
async function waitForMailpitMessage(
  subject: string,
  recipient: string,
  ownMessageIds: string[],
): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    const res = await fetch(`${MAILPIT_API}/messages`)
    const json = (await res.json()) as { messages: MailpitMessage[] }
    const found = json.messages.find(
      (m) => m.Subject === subject && m.To.some((t) => t.Address === recipient),
    )
    if (found) {
      ownMessageIds.push(found.ID)
      const detail = (await (
        await fetch(`${MAILPIT_API}/message/${found.ID}`)
      ).json()) as MailpitDetail
      return `${detail.Text}\n${detail.HTML}`
    }
  }
  throw new Error(`Mailpit message not found: subject=${subject} to=${recipient}`)
}

/**
 * Delete only the messages this run created. Mailpit v1.30.7 has no
 * per-message delete endpoint (DELETE /api/v1/message/{id} is 405), so the
 * mailbox is cleaned via DELETE /api/v1/search scoped to the run-unique
 * recipient address — the whole-mailbox DELETE is never used.
 */
async function deleteOwnMailpitMessages(recipients: string[]): Promise<void> {
  for (const recipient of recipients) {
    const query = encodeURIComponent(`to:"${recipient}"`)
    await fetch(`${MAILPIT_API}/search?query=${query}`, { method: 'DELETE' })
  }
}

// ---------------------------------------------------------------------------
// Suite 1 — password reset e2e (Mailpit gated)
// ---------------------------------------------------------------------------

describe.skipIf(!mailpitUp)('password reset e2e (SMTP + Mailpit)', () => {
  let app: Sinopebase
  let baseUrl: string
  const email = `reset-e2e-${Date.now()}@example.com`
  const oldPassword = 'old-password-123'
  const newPassword = 'new-password-456'
  // Only our own messages are deleted — never the whole mailbox.
  const ownMessageIds: string[] = []

  beforeAll(async () => {
    const portReservation = await reserveLoopbackPort()
    app = new Sinopebase({
      port: portReservation.port,
      postgresUrl: requirePostgres(),
      jwtSecret: JWT_SECRET,
      serviceRoleKey: SERVICE_KEY,
      anonKey: ANON_KEY,
      smtp: { enabled: true, host: 'localhost', port: 1025 },
    })
    await portReservation.release()
    await app.start()
    baseUrl = portReservation.origin

    const client = createClient(baseUrl, ANON_KEY)
    const signUp = await client.auth.signUp({ email, password: oldPassword })
    expect(signUp.error).toBeNull()
  })

  afterAll(async () => {
    await deleteOwnMailpitMessages([email])
    await app.stop()
  })

  it('instantiates the SMTP mailer when smtp is configured', () => {
    expect(app.mailer).not.toBeNull()
  })

  it('sends a reset email and completes a password reset end to end over HTTP', async () => {
    // The product route triggers better-auth's requestPasswordReset, which
    // delivers the reset email through the SMTP mailer (no direct auth.api).
    const headers = { 'Content-Type': 'application/json', apikey: ANON_KEY }
    const res = await fetch(`${baseUrl}/auth/v1/reset-password`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({})

    // Poll Mailpit until the reset email arrives.
    // ponytail: fixed 5s window; local Mailpit delivery lands in well under 2s.
    const messageBody = await waitForMailpitMessage(RESET_SUBJECT, email, ownMessageIds)
    expect(ownMessageIds).toHaveLength(1)
    expect(messageBody).toContain('reset-password/')

    // The emailed URL is better-auth's reset page .../reset-password/<token>.
    // The token is the path segment; completing the reset posts it back to
    // the HTTP reset endpoint with the new password.
    // ponytail: one regex over text+html beats URL parsing for a single field.
    const token = /reset-password\/([A-Za-z0-9_-]+)/.exec(messageBody)?.[1]
    expect(token).toBeTruthy()

    // POST /api/auth/reset-password — better-auth's own route (see
    // node_modules/better-auth/dist/api/routes/password.mjs).
    const reset = await fetch(`${baseUrl}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword, token }),
    })
    expect(reset.status).toBe(200)
    expect(await reset.json()).toEqual({ status: true })

    // Sign in with the new password; the old password must be rejected.
    const client = createClient(baseUrl, ANON_KEY)
    const withNew = await client.auth.signInWithPassword({ email, password: newPassword })
    expect(withNew.error).toBeNull()
    expect(withNew.data?.session?.user.email).toBe(email)

    const withOld = await client.auth.signInWithPassword({ email, password: oldPassword })
    expect(withOld.error).not.toBeNull()
    expect(withOld.error?.status).toBe(400)
    expect(withOld.data?.session).toBeNull()
  }, 15000)

  it('answers reset requests with success for unknown emails (anti-enumeration)', async () => {
    const headers = { 'Content-Type': 'application/json', apikey: ANON_KEY }
    const res = await fetch(`${baseUrl}/auth/v1/reset-password`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: `ghost-${Date.now()}@example.com` }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// Suite 2 — email verification e2e (Mailpit gated)
// ---------------------------------------------------------------------------

describe.skipIf(!mailpitUp)('email verification e2e (SMTP + Mailpit)', () => {
  let app: Sinopebase
  let baseUrl: string
  let pool: Pool
  const email = `verify-e2e-${Date.now()}@example.com`
  const password = 'verify-password-123'
  // Only our own messages are deleted — never the whole mailbox.
  const ownMessageIds: string[] = []

  beforeAll(async () => {
    const portReservation = await reserveLoopbackPort()
    app = new Sinopebase({
      port: portReservation.port,
      postgresUrl: requirePostgres(),
      jwtSecret: JWT_SECRET,
      serviceRoleKey: SERVICE_KEY,
      anonKey: ANON_KEY,
      smtp: { enabled: true, host: 'localhost', port: 1025 },
    })
    await portReservation.release()
    await app.start()
    baseUrl = portReservation.origin
    pool = new Pool({ connectionString: requirePostgres() })

    const client = createClient(baseUrl, ANON_KEY)
    const signUp = await client.auth.signUp({ email, password })
    expect(signUp.error).toBeNull()
  })

  afterAll(async () => {
    await deleteOwnMailpitMessages([email])
    await pool.end()
    await app.stop()
  })

  it('starts with emailVerified false in the user table', async () => {
    const row = await pool.query('SELECT "emailVerified" FROM "user" WHERE email = $1', [email])
    expect(row.rows[0]?.emailVerified).toBe(false)
  })

  it('verifies an email end to end over HTTP', async () => {
    // POST /api/auth/send-verification-email triggers better-auth's
    // sendVerificationEmail, wired to the SMTP mailer. Without a session the
    // route enforces a 500ms floor against timing attacks — expected.
    const send = await fetch(`${baseUrl}/api/auth/send-verification-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    expect(send.status).toBe(200)
    expect(await send.json()).toEqual({ status: true })

    // Poll Mailpit until the verification email arrives.
    // ponytail: fixed 5s window; local Mailpit delivery lands in well under 2s.
    const messageBody = await waitForMailpitMessage(VERIFY_SUBJECT, email, ownMessageIds)
    expect(ownMessageIds).toHaveLength(1)
    expect(messageBody).toContain('verify-email?token=')

    // The emailed URL is better-auth's verify page .../verify-email?token=<jwt>.
    // The token is a JWT; the callbackURL from the email is dropped so the
    // verify route answers with JSON instead of a redirect.
    // ponytail: one regex over text+html beats URL parsing for a single field.
    const token = /verify-email\?token=([^&\s"']+)/.exec(messageBody)?.[1]
    expect(token).toBeTruthy()

    // GET /api/auth/verify-email — better-auth's own route (see
    // node_modules/better-auth/dist/api/routes/email-verification.mjs).
    const verify = await fetch(`${baseUrl}/api/auth/verify-email?token=${token}`)
    expect(verify.status).toBe(200)
    expect(await verify.json()).toEqual({ status: true, user: null })

    const row = await pool.query('SELECT "emailVerified" FROM "user" WHERE email = $1', [email])
    expect(row.rows[0]?.emailVerified).toBe(true)
  }, 15000)
})

// ---------------------------------------------------------------------------
// Suite 3 — reset flow without SMTP configured
// ---------------------------------------------------------------------------

describe('password recovery without SMTP', () => {
  let app: Sinopebase
  let baseUrl: string
  const email = `reset-nosmtp-${Date.now()}@example.com`

  beforeAll(async () => {
    const portReservation = await reserveLoopbackPort()
    app = new Sinopebase({
      port: portReservation.port,
      postgresUrl: requirePostgres(),
      jwtSecret: JWT_SECRET,
      serviceRoleKey: SERVICE_KEY,
      anonKey: ANON_KEY,
    })
    await portReservation.release()
    await app.start()
    baseUrl = portReservation.origin

    const client = createClient(baseUrl, ANON_KEY)
    const signUp = await client.auth.signUp({ email, password: 'old-password-123' })
    expect(signUp.error).toBeNull()
  })

  afterAll(async () => {
    await app.stop()
  })

  it('keeps the mailer unset when smtp is not configured', () => {
    expect(app.mailer).toBeNull()
  })

  it('answers reset requests with success and no crash (anti-enumeration)', async () => {
    const headers = { 'Content-Type': 'application/json', apikey: ANON_KEY }
    // Known email, unknown email, and a missing body all succeed identically.
    for (const body of [{ email }, { email: `ghost-${Date.now()}@example.com` }, {}]) {
      const res = await fetch(`${baseUrl}/auth/v1/reset-password`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({})
    }
  })

  it('rejects a garbage verify-email token over HTTP (error, not 200)', async () => {
    // better-auth exposes verify-email as GET /api/auth/verify-email?token=...
    // (the endpoint is GET, not POST — see
    // node_modules/better-auth/dist/api/routes/email-verification.mjs).
    // Without a callbackURL the route answers 401 for a bad token.
    const res = await fetch(`${baseUrl}/api/auth/verify-email?token=garbage-token`)
    expect(res.status).not.toBe(200)
  })
})
