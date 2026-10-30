/**
 * Password lifecycle ATDD over real HTTP with the official supabase-js client:
 * password change (PUT /auth/v1/user, #57), GoTrue recovery (/auth/v1/recover,
 * /auth/v1/verify, #67), email verification, and the no-SMTP contract.
 *
 * Requires PostgreSQL (TEST_POSTGRES_URL). The e2e suites also require the
 * `mail` service from docker-compose.yml (SMTP localhost:1025, API
 * http://localhost:8025/api/v1) and skip when Mailpit is unreachable,
 * mirroring tests/integration/mailer.test.ts.
 *
 * @new-code-test positive src/apis/auth.ts
 * @new-code-test negative src/apis/auth.ts
 * @new-code-test positive src/tools/auth-better/index.ts
 * @new-code-test negative src/tools/auth-better/index.ts
 * @new-code-test positive src/tools/auth-better/adapter.ts
 * @new-code-test negative src/tools/auth-better/adapter.ts
 * @new-code-test positive src/core/app.ts
 * @new-code-test negative src/core/app.ts
 * @new-code-test positive src/sdk/auth-impl.ts
 * @new-code-test negative src/sdk/auth-impl.ts
 * @new-code-test positive src/sdk/auth.ts
 * @new-code-test negative src/sdk/auth.ts
 * @new-code-test positive src/tools/auth-better/recovery-links.ts
 * @new-code-test negative src/tools/auth-better/recovery-links.ts
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { Pool } from 'pg'
import { authPlugin } from '~/apis/auth'
import { Sinopebase } from '~/core/app'
import { createClient as createSinopebaseClient } from '~/sdk/client'
import { requirePostgres, reserveLoopbackPort } from '../harness'

const MAILPIT_API = process.env.TEST_MAILPIT_API_URL ?? 'http://localhost:8025/api/v1'
const RESET_SUBJECT = 'Reset your password'
const VERIFY_SUBJECT = 'Verify your email'
const ANON_KEY = 'auth-recovery-anon-key-min-32-chars!!'
const JWT_SECRET = 'auth-recovery-jwt-secret-min-32-char!'
const SERVICE_KEY = 'auth-recovery-service-key-min-32-chars'
/** Sinope's browser origin: a trusted redirect_to. */
const APP_ORIGIN = 'http://localhost:5173'
const CONFIRM_URL = `${APP_ORIGIN}/auth/confirm?next=/account/new-password`
/** GoTrue SITE_URL fallback for missing or untrusted redirect_to. */
const SITE_URL = 'http://site.example.test/welcome'
/** GoTrue SMTP_ADMIN_EMAIL / SMTP_SENDER_NAME. */
const SENDER = { address: 'noreply@mail.sinopebase.test', name: 'Sinopebase Test' }
const SMTP = {
  enabled: true,
  host: process.env.TEST_SMTP_HOST ?? 'localhost',
  port: Number(process.env.TEST_SMTP_PORT ?? 1025),
  fromAddress: SENDER.address,
  fromName: SENDER.name,
}

interface MailpitMessage {
  ID: string
  Subject: string
  From: { Name: string; Address: string }
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

/** Messages addressed to a run-unique recipient, newest first. */
async function mailFor(recipient: string, subject: string): Promise<MailpitMessage[]> {
  const query = encodeURIComponent(`to:"${recipient}"`)
  const res = await fetch(`${MAILPIT_API}/search?query=${query}`)
  const json = (await res.json()) as { messages: MailpitMessage[] }
  return json.messages.filter((m) => m.Subject === subject)
}

/**
 * Poll Mailpit until a message with the given subject, not yet in `seen`,
 * arrives for the recipient; record it and return its text+html body.
 */
async function waitForMailpitMessage(
  subject: string,
  recipient: string,
  seen: Set<string> = new Set(),
): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    // Mailpit is an external SMTP sink; delivery is observable only by polling.
    await Bun.sleep(250)
    const found = (await mailFor(recipient, subject)).find((m) => !seen.has(m.ID))
    if (found) {
      seen.add(found.ID)
      const detail = (await (
        await fetch(`${MAILPIT_API}/message/${found.ID}`)
      ).json()) as MailpitDetail
      return `${detail.Text}\n${detail.HTML}`
    }
  }
  throw new Error(`Mailpit message not found: subject=${subject} to=${recipient}`)
}

/** The GoTrue recovery link from the next unseen recovery email. */
async function nextRecoveryLink(recipient: string, seen: Set<string>): Promise<URL> {
  const body = await waitForMailpitMessage(RESET_SUBJECT, recipient, seen)
  const link = /Reset your password: (\S+)/.exec(body)?.[1]
  if (!link) throw new Error(`Recovery link missing in mail to ${recipient}`)
  return new URL(link)
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
// Suite 1 — GoTrue password change and recovery (official SDK, Mailpit gated)
// ---------------------------------------------------------------------------

describe.skipIf(!mailpitUp)('GoTrue password change and recovery (supabase-js + Mailpit)', () => {
  let app: Sinopebase
  let baseUrl: string
  let pool: Pool
  const run = crypto.randomUUID().slice(0, 8)
  const emails: string[] = []

  function sdk(): SupabaseClient {
    return createSupabaseClient(baseUrl, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
  }

  /** A signed-up user whose returned client holds the sign-up session. */
  async function newUser(label: string) {
    const email = `${label}-${run}@example.com`
    const password = `old-${crypto.randomUUID()}`
    emails.push(email)
    const client = sdk()
    const signUp = await client.auth.signUp({ email, password })
    expect(signUp.error).toBeNull()
    return { email, password, client, id: signUp.data.user?.id as string }
  }

  async function signedIn(email: string, password: string) {
    const client = sdk()
    expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull()
    return client
  }

  async function canSignIn(email: string, password: string) {
    return (await sdk().auth.signInWithPassword({ email, password })).error === null
  }

  async function sessionAlive(client: SupabaseClient) {
    return (await client.auth.getUser()).error === null
  }

  async function requestRecovery(email: string, redirectTo?: string) {
    const result = await sdk().auth.resetPasswordForEmail(email, { redirectTo })
    expect(result).toEqual({ data: {}, error: null })
  }

  /** Expire the user's 60 s recovery claim instead of waiting for it. */
  async function endRecoveryInterval(userId: string) {
    const ended = await pool.query(
      `UPDATE verification SET "expiresAt" = now() - interval '1 second' WHERE identifier = $1`,
      [`recovery-sent:${userId}`],
    )
    expect(ended.rowCount).toBe(1)
  }

  async function tokenHash(email: string, seen: Set<string>) {
    return (await nextRecoveryLink(email, seen)).searchParams.get('token_hash') as string
  }

  async function recoveryRows(userId: string) {
    const rows = await pool.query<{ identifier: string }>(
      `SELECT identifier FROM verification
        WHERE (identifier LIKE 'reset-password:%' AND value = $1)
           OR identifier LIKE 'recovery-email:%' AND substr(identifier, 16) IN (
             SELECT substr(identifier, 16) FROM verification WHERE value = $1)
           OR identifier = 'recovery-sent:' || $1`,
      [userId],
    )
    return rows.rows.map((row) => row.identifier.split(':')[0]).sort()
  }

  beforeAll(async () => {
    const portReservation = await reserveLoopbackPort()
    app = new Sinopebase({
      port: portReservation.port,
      postgresUrl: requirePostgres(),
      jwtSecret: JWT_SECRET,
      serviceRoleKey: SERVICE_KEY,
      anonKey: ANON_KEY,
      extraOrigins: [APP_ORIGIN],
      siteUrl: SITE_URL,
      smtp: SMTP,
    })
    await portReservation.release()
    await app.start()
    baseUrl = portReservation.origin
    pool = new Pool({ connectionString: requirePostgres() })
  })

  afterAll(async () => {
    await deleteOwnMailpitMessages(emails)
    await pool.query(
      'DELETE FROM verification WHERE value IN (SELECT id FROM "user" WHERE email = ANY($1))',
      [emails],
    )
    await pool.query('DELETE FROM "user" WHERE email = ANY($1)', [emails])
    await pool.end()
    await app.stop()
  })

  it('changes the password with current_password, keeps the caller and revokes other sessions', async () => {
    const user = await newUser('change')
    const other = await signedIn(user.email, user.password)
    const newPassword = `new-${crypto.randomUUID()}`

    const update = await user.client.auth.updateUser({
      password: newPassword,
      current_password: user.password,
    })
    expect(update.error).toBeNull()
    expect(update.data.user?.id).toBe(user.id)

    expect(await sessionAlive(user.client)).toBe(true)
    expect(await sessionAlive(other)).toBe(false)
    expect((await other.auth.refreshSession()).error).not.toBeNull()
    expect(await canSignIn(user.email, user.password)).toBe(false)
    expect(await canSignIn(user.email, newPassword)).toBe(true)
  })

  it('refuses a missing or incorrect current_password and revokes nothing', async () => {
    const user = await newUser('change-refused')
    const other = await signedIn(user.email, user.password)
    const newPassword = `new-${crypto.randomUUID()}`

    const missing = await user.client.auth.updateUser({ password: newPassword })
    expect(missing.error?.status).toBe(400)
    expect(missing.error?.code).toBe('current_password_required')

    const wrong = await user.client.auth.updateUser({
      password: newPassword,
      current_password: 'not-the-current-password',
    })
    expect(wrong.error?.status).toBe(400)
    expect(wrong.error?.code).toBe('current_password_mismatch')
    expect(wrong.error?.message).toBe('Current password is incorrect')

    expect(await sessionAlive(other)).toBe(true)
    expect(await canSignIn(user.email, user.password)).toBe(true)
    expect(await canSignIn(user.email, newPassword)).toBe(false)
  })

  it('rejects weak and unchanged passwords with GoTrue 422 codes', async () => {
    const user = await newUser('change-policy')
    for (const [password, message] of [
      ['x'.repeat(7), 'Password should be at least 8 characters.'],
      ['x'.repeat(129), 'Password should be at most 128 characters.'],
    ] as const) {
      const weak = await user.client.auth.updateUser({ password, current_password: user.password })
      expect(weak.error?.status).toBe(422)
      expect(weak.error?.code).toBe('weak_password')
      expect(weak.error?.message).toBe(message)
      expect((weak.error as unknown as { reasons: string[] }).reasons).toEqual(['length'])
    }
    const same = await user.client.auth.updateUser({
      password: user.password,
      current_password: user.password,
    })
    expect(same.error?.status).toBe(422)
    expect(same.error?.code).toBe('same_password')
    expect(await canSignIn(user.email, user.password)).toBe(true)
  })

  it('answers known and unknown emails identically and mails only the known one', async () => {
    const user = await newUser('recover-known')
    const ghost = `ghost-${run}@example.com`
    emails.push(ghost)
    await requestRecovery(user.email, CONFIRM_URL)
    await requestRecovery(ghost, CONFIRM_URL)

    const link = await nextRecoveryLink(user.email, new Set())
    expect(link.origin).toBe(APP_ORIGIN)
    expect(link.pathname).toBe('/auth/confirm')
    expect(link.searchParams.get('next')).toBe('/account/new-password')
    expect(link.searchParams.get('type')).toBe('recovery')
    expect(link.searchParams.get('token_hash')).toMatch(/^[A-Za-z0-9]{24}$/)
    expect(await mailFor(ghost, RESET_SUBJECT)).toEqual([])
    const [sent] = await mailFor(user.email, RESET_SUBJECT)
    expect(sent?.From).toEqual({ Name: SENDER.name, Address: SENDER.address })
  }, 20000)

  it('refuses a recovery link once the account no longer has the address it was sent to', async () => {
    const user = await newUser('recover-email-change')
    const seen = new Set<string>()
    await requestRecovery(user.email, CONFIRM_URL)
    const mailed = await tokenHash(user.email, seen)

    // Changing the address retires the outstanding link (GoTrue binds it to the old one).
    const moved = `moved-${user.email}`
    emails.push(moved)
    expect((await user.client.auth.updateUser({ email: moved })).error).toBeNull()
    expect(await recoveryRows(user.id)).toEqual(['recovery-sent'])
    const retired = await sdk().auth.verifyOtp({ type: 'recovery', token_hash: mailed })
    expect(retired.error?.code).toBe('otp_expired')

    // Even a surviving token is refused once the address differs, and verifies nothing.
    await endRecoveryInterval(user.id)
    await requestRecovery(moved, CONFIRM_URL)
    const second = await tokenHash(moved, new Set())
    await pool.query('UPDATE "user" SET email = $1 WHERE id = $2', [user.email, user.id])
    const swapped = await sdk().auth.verifyOtp({ type: 'recovery', token_hash: second })
    expect(swapped.error?.status).toBe(403)
    expect(swapped.error?.code).toBe('otp_expired')
    const row = await pool.query('SELECT "emailVerified" FROM "user" WHERE id = $1', [user.id])
    expect(row.rows[0]?.emailVerified).toBe(false)
  }, 30000)

  it('serialises concurrent password changes from two sessions without deadlock', async () => {
    for (let round = 0; round < 5; round++) {
      const user = await newUser(`change-race-${round}`)
      const other = await signedIn(user.email, user.password)
      const results = await Promise.all(
        [user.client, other].map((client) =>
          client.auth.updateUser({
            password: `raced-${crypto.randomUUID()}`,
            current_password: user.password,
          }),
        ),
      )
      // One change wins and revokes the other session, which then reads as signed out
      // (session_not_found); a deadlock would surface as a retryable 500 instead.
      const outcomes = results.map((result) => result.error?.name ?? 'updated').sort()
      expect(outcomes).toEqual(['AuthSessionMissingError', 'updated'])
    }
  }, 30000)

  it('keeps earlier links and reopens the interval when delivery fails', async () => {
    const user = await newUser('recover-smtp-down')
    const seen = new Set<string>()
    await requestRecovery(user.email, CONFIRM_URL)
    const earlier = await tokenHash(user.email, seen)
    await endRecoveryInterval(user.id)

    // A second server on the same database whose SMTP endpoint refuses connections (port 1).
    const portReservation = await reserveLoopbackPort()
    const unreachable = new Sinopebase({
      port: portReservation.port,
      postgresUrl: requirePostgres(),
      jwtSecret: JWT_SECRET,
      serviceRoleKey: SERVICE_KEY,
      anonKey: ANON_KEY,
      extraOrigins: [APP_ORIGIN],
      siteUrl: SITE_URL,
      smtp: { ...SMTP, host: '127.0.0.1', port: 1 },
    })
    await portReservation.release()
    await unreachable.start()
    try {
      const failed = await createSupabaseClient(portReservation.origin, ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      }).auth.resetPasswordForEmail(user.email, { redirectTo: CONFIRM_URL })
      expect(failed).toEqual({ data: {}, error: null })
    } finally {
      await unreachable.stop()
    }
    expect(await recoveryRows(user.id)).toEqual(['recovery-email', 'reset-password'])

    // The retry is not throttled, and its link replaces the earlier one.
    await requestRecovery(user.email, CONFIRM_URL)
    const retried = await tokenHash(user.email, seen)
    expect(retried).not.toBe(earlier)
    expect(await recoveryRows(user.id)).toEqual([
      'recovery-email',
      'recovery-sent',
      'reset-password',
    ])
    const replaced = await sdk().auth.verifyOtp({ type: 'recovery', token_hash: earlier })
    expect(replaced.error?.code).toBe('otp_expired')
    expect((await sdk().auth.verifyOtp({ type: 'recovery', token_hash: retried })).error).toBeNull()
  }, 30000)

  it('falls back to the site URL for an untrusted redirect_to and throttles repeats', async () => {
    const user = await newUser('recover-fallback')
    await requestRecovery(user.email, 'https://evil.example.com/steal')
    const link = await nextRecoveryLink(user.email, new Set())
    expect(`${link.origin}${link.pathname}`).toBe(SITE_URL)
    expect(link.searchParams.get('type')).toBe('recovery')
    expect(link.searchParams.get('token_hash')).toBeTruthy()

    // A second request inside GoTrue's 60 s window answers {} without mailing.
    // The request awaits delivery, so a short real wait covers Mailpit ingestion.
    await requestRecovery(user.email, CONFIRM_URL)
    await Bun.sleep(750)
    expect(await mailFor(user.email, RESET_SUBJECT)).toHaveLength(1)
  }, 20000)

  it('sends a single link for concurrent recovery requests', async () => {
    const user = await newUser('recover-concurrent')
    await Promise.all([1, 2, 3].map(() => requestRecovery(user.email, CONFIRM_URL)))
    await nextRecoveryLink(user.email, new Set())
    // Every request awaited its delivery; the wait covers Mailpit ingestion only.
    await Bun.sleep(750)
    expect(await mailFor(user.email, RESET_SUBJECT)).toHaveLength(1)
    const live = await pool.query(
      `SELECT count(*)::int AS n FROM verification WHERE value = $1 AND identifier LIKE 'reset-password:%'`,
      [user.id],
    )
    expect(live.rows[0]?.n).toBe(1)
  }, 20000)

  it('rejects malformed recovery and verification requests', async () => {
    const recover = await sdk().auth.resetPasswordForEmail('not-an-email')
    expect(recover.error?.status).toBe(400)
    expect(recover.error?.code).toBe('validation_failed')

    const unsupported = await sdk().auth.verifyOtp({ type: 'signup', token_hash: 'anything' })
    expect(unsupported.error?.status).toBe(400)
    expect(unsupported.error?.code).toBe('validation_failed')

    const unknown = await sdk().auth.verifyOtp({ type: 'recovery', token_hash: 'not-a-token' })
    expect(unknown.error?.status).toBe(403)
    expect(unknown.error?.code).toBe('otp_expired')
    expect(unknown.data.session).toBeNull()
  })

  it('opens a recovery session that sets a password without current_password and revokes the rest', async () => {
    const user = await newUser('recover-session')
    const other = await signedIn(user.email, user.password)
    await requestRecovery(user.email, CONFIRM_URL)
    const tokenHash = (await nextRecoveryLink(user.email, new Set())).searchParams.get(
      'token_hash',
    ) as string

    const recovering = sdk()
    const events: string[] = []
    recovering.auth.onAuthStateChange((event) => {
      events.push(event)
    })
    const verified = await recovering.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash })
    expect(verified.error).toBeNull()
    expect(verified.data.user?.id).toBe(user.id)
    expect(verified.data.user?.email_confirmed_at).toBeTruthy()
    expect(verified.data.session?.refresh_token).toBeTruthy()
    expect(events).toContain('PASSWORD_RECOVERY')
    const accessToken = verified.data.session?.access_token as string
    const marked = await pool.query('SELECT "authMethod" FROM session WHERE token = $1', [
      accessToken,
    ])
    expect(marked.rows[0]?.authMethod).toBe('recovery')

    const newPassword = `recovered-${crypto.randomUUID()}`
    const set = await recovering.auth.updateUser({ password: newPassword })
    expect(set.error).toBeNull()

    expect(await sessionAlive(recovering)).toBe(true)
    expect(await sessionAlive(user.client)).toBe(false)
    expect(await sessionAlive(other)).toBe(false)
    expect(await canSignIn(user.email, user.password)).toBe(false)
    expect(await canSignIn(user.email, newPassword)).toBe(true)

    // The recovery allowance is spent: the session is now an ordinary one.
    const cleared = await pool.query('SELECT "authMethod" FROM session WHERE token = $1', [
      accessToken,
    ])
    expect(cleared.rows[0]?.authMethod).toBeNull()
    const again = await recovering.auth.updateUser({ password: `again-${crypto.randomUUID()}` })
    expect(again.error?.code).toBe('current_password_required')
  }, 20000)

  it('refuses a recovery token with no recorded address', async () => {
    const user = await newUser('recover-unbound')
    await requestRecovery(user.email, CONFIRM_URL)
    const token = await tokenHash(user.email, new Set())
    await pool.query('DELETE FROM verification WHERE identifier = $1', [`recovery-email:${token}`])
    const unbound = await sdk().auth.verifyOtp({ type: 'recovery', token_hash: token })
    expect(unbound.error?.code).toBe('otp_expired')
  }, 20000)

  it('creates the native credential when a recovered account had none', async () => {
    const user = await newUser('recover-no-credential')
    await pool.query(`DELETE FROM account WHERE "userId" = $1 AND "providerId" = 'credential'`, [
      user.id,
    ])
    await requestRecovery(user.email, CONFIRM_URL)
    const token = await tokenHash(user.email, new Set())
    const recovering = sdk()
    expect(
      (await recovering.auth.verifyOtp({ type: 'recovery', token_hash: token })).error,
    ).toBeNull()
    const password = `first-${crypto.randomUUID()}`
    expect((await recovering.auth.updateUser({ password })).error).toBeNull()
    expect(await canSignIn(user.email, password)).toBe(true)
  }, 20000)

  it('keeps recovery links when the address changes only in case', async () => {
    const user = await newUser('recover-case')
    await requestRecovery(user.email, CONFIRM_URL)
    const token = await tokenHash(user.email, new Set())
    expect(
      (await user.client.auth.updateUser({ email: user.email.toUpperCase() })).error,
    ).toBeNull()
    expect((await sdk().auth.verifyOtp({ type: 'recovery', token_hash: token })).error).toBeNull()
  }, 20000)

  it('keeps recovery tokens single-use, replaced by newer links, and expiring', async () => {
    const user = await newUser('recover-token')
    const seen = new Set<string>()
    await requestRecovery(user.email, CONFIRM_URL)
    const first = (await nextRecoveryLink(user.email, seen)).searchParams.get('token_hash')

    // Leave the 60 s window: a newer link replaces the older one.
    await endRecoveryInterval(user.id)
    await requestRecovery(user.email, CONFIRM_URL)
    const second = (await nextRecoveryLink(user.email, seen)).searchParams.get('token_hash')
    expect(second).not.toBe(first)

    const replaced = await sdk().auth.verifyOtp({ type: 'recovery', token_hash: first as string })
    expect(replaced.error?.code).toBe('otp_expired')
    const used = await sdk().auth.verifyOtp({ type: 'recovery', token_hash: second as string })
    expect(used.error).toBeNull()
    const reused = await sdk().auth.verifyOtp({ type: 'recovery', token_hash: second as string })
    expect(reused.error?.status).toBe(403)
    expect(reused.error?.code).toBe('otp_expired')

    // Using a link does not reopen the window; only its expiry does.
    await requestRecovery(user.email, CONFIRM_URL)
    await Bun.sleep(750)
    expect(await mailFor(user.email, RESET_SUBJECT)).toHaveLength(2)
    await endRecoveryInterval(user.id)
    await requestRecovery(user.email, CONFIRM_URL)
    const third = (await nextRecoveryLink(user.email, seen)).searchParams.get('token_hash')
    await pool.query(
      `UPDATE verification SET "expiresAt" = now() - interval '1 second' WHERE identifier = $1`,
      [`reset-password:${third}`],
    )
    const expired = await sdk().auth.verifyOtp({ type: 'recovery', token_hash: third as string })
    expect(expired.error?.status).toBe(403)
    expect(expired.error?.code).toBe('otp_expired')
    expect(await canSignIn(user.email, user.password)).toBe(true)
  }, 30000)

  it('drives recovery from the Sinopebase SDK with and without redirectTo', async () => {
    const withRedirect = await newUser('sdk-redirect')
    const client = createSinopebaseClient(baseUrl, ANON_KEY)
    expect(
      await client.auth.resetPasswordForEmail(withRedirect.email, { redirectTo: CONFIRM_URL }),
    ).toEqual({ data: {}, error: null })
    expect((await nextRecoveryLink(withRedirect.email, new Set())).origin).toBe(APP_ORIGIN)

    const withoutRedirect = await newUser('sdk-default')
    expect(await client.auth.resetPasswordForEmail(withoutRedirect.email)).toEqual({
      data: {},
      error: null,
    })
    const link = await nextRecoveryLink(withoutRedirect.email, new Set())
    expect(`${link.origin}${link.pathname}`).toBe(SITE_URL)
  }, 20000)

  it('keeps Better Auth native reset routes closed', async () => {
    for (const path of ['/api/auth/request-password-reset', '/api/auth/reset-password']) {
      const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `closed-${run}@example.com`, token: 'x', newPassword: 'y' }),
      })
      expect(res.status).toBe(404)
    }
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

  beforeAll(async () => {
    const portReservation = await reserveLoopbackPort()
    app = new Sinopebase({
      port: portReservation.port,
      postgresUrl: requirePostgres(),
      jwtSecret: JWT_SECRET,
      serviceRoleKey: SERVICE_KEY,
      anonKey: ANON_KEY,
      smtp: SMTP,
    })
    await portReservation.release()
    await app.start()
    baseUrl = portReservation.origin
    pool = new Pool({ connectionString: requirePostgres() })

    const client = createSinopebaseClient(baseUrl, ANON_KEY)
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
    const seen = new Set<string>()
    const messageBody = await waitForMailpitMessage(VERIFY_SUBJECT, email, seen)
    expect(seen.size).toBe(1)
    const [sent] = await mailFor(email, VERIFY_SUBJECT)
    expect(sent?.From).toEqual({ Name: SENDER.name, Address: SENDER.address })
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
// Suite 3 — recovery without SMTP configured
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

    const client = createSinopebaseClient(baseUrl, ANON_KEY)
    const signUp = await client.auth.signUp({ email, password: 'old-password-123' })
    expect(signUp.error).toBeNull()
  })

  afterAll(async () => {
    await app.stop()
  })

  it('keeps the mailer unset when smtp is not configured', () => {
    expect(app.mailer).toBeNull()
  })

  it('answers recovery requests with {} and no crash (anti-enumeration)', async () => {
    const client = createSupabaseClient(baseUrl, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    for (const address of [email, `ghost-${Date.now()}@example.com`]) {
      expect(await client.auth.resetPasswordForEmail(address)).toEqual({ data: {}, error: null })
    }
  })

  it('answers the in-memory fallback recovery route with {}', async () => {
    const res = await authPlugin.handle(
      new Request('http://localhost/auth/v1/recover', { method: 'POST' }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({})
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
