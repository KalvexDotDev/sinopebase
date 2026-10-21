/**
 * Real native verification, official SDK and PostgreSQL boundaries. No auth mocks.
 * @new-code-test positive src/apis/auth.ts
 * @new-code-test negative src/apis/auth.ts
 * @new-code-test positive src/tools/auth-better/adapter.ts
 * @new-code-test negative src/tools/auth-better/adapter.ts
 * @new-code-test positive src/tools/auth-better/index.ts
 * @new-code-test negative src/tools/auth-better/index.ts
 * @new-code-test positive src/tools/auth-better/types.ts
 * @new-code-test negative src/tools/auth-better/types.ts
 * @new-code-test positive src/tools/auth-better/supabase-bridge.ts
 * @new-code-test negative src/tools/auth-better/supabase-bridge.ts
 */
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { createClient } from '@supabase/supabase-js'
import { Pool } from 'pg'
import { z } from 'zod'
import { createAuthPlugin } from '~/apis/auth'
import { createAuth, createRefreshTokensTable } from '~/tools/auth-better'
import { createAuthTables, createBetterAuthDB } from '~/tools/auth-better/adapter'
import { requirePostgres, reserveLoopbackPort } from '../harness'

// Actual native verification and compatible HTTP routes; only outbound mail is captured locally.
const email = `confirmation-${crypto.randomUUID()}@example.test`
const password = crypto.randomUUID()
const changedEmail = `changed-${crypto.randomUUID()}@example.test`
const spoofEmail = `spoof-${crypto.randomUUID()}@example.test`
const spoofVerifiedEmail = `spoof-verified-${crypto.randomUUID()}@example.test`
const previousOrigin = process.env.BETTER_AUTH_URL
const databaseName = `email_confirmation_${crypto.randomUUID().replaceAll('-', '')}`
const legacyId = crypto.randomUUID()
let adminPool: Pool | undefined
let databaseCreated = false
let pool: Pool | undefined
let server: ReturnType<typeof createAuthPlugin> | undefined
let origin: string
let verificationUrl: string | undefined
let setup: Promise<void> | undefined
let operation: Promise<void> | undefined

beforeAll(async () => {
  setup = (async () => {
    let connection: URL
    try {
      connection = new URL(requirePostgres())
    } catch {
      throw new Error('Verification test requires a plain loopback database URL')
    }
    if (
      !['postgres:', 'postgresql:'].includes(connection.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(connection.hostname) ||
      connection.search ||
      connection.hash
    )
      throw new Error('Verification test requires a plain loopback database URL')
    const port = await reserveLoopbackPort()
    origin = port.origin
    process.env.BETTER_AUTH_URL = origin
    try {
      adminPool = new Pool({ connectionString: connection.href })
      databaseCreated = true
      await adminPool.query(`CREATE DATABASE "${databaseName}"`)
      connection.pathname = `/${databaseName}`
      pool = new Pool({ connectionString: connection.href })
      // Real pre-upgrade schema and existing verified row: no historical time is available.
      await pool.query(`CREATE TABLE public."user" (
        id varchar(36) PRIMARY KEY, email varchar(255) NOT NULL,
        "emailVerified" boolean NOT NULL DEFAULT false, name varchar(255), image text,
        role varchar(50) NOT NULL DEFAULT 'user',
        "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
      )`)
      await pool.query('INSERT INTO public."user" (id,email,"emailVerified") VALUES ($1,$2,true)', [
        legacyId,
        `legacy-${legacyId}@example.test`,
      ])
      const database = createBetterAuthDB(pool)
      // Same public startup primitives; explicit calls keep this isolated DB independent of
      // the factory's process-wide hot-reload guard when the complete suite shares a process.
      await createAuthTables(database)
      await createRefreshTokensTable(database)
      const auth = await createAuth(pool, {
        jwtSecret: crypto.randomUUID() + crypto.randomUUID(),
        extraOrigins: [origin],
        sendEmail: async (mail) => {
          if (![email, changedEmail].includes(mail.to))
            throw new Error('Unexpected synthetic mail recipient')
          const match = /https?:\/\/[^\s]+/.exec(mail.text)
          if (!match) throw new Error('Synthetic verification link missing')
          const url = new URL(match[0])
          if (url.origin !== origin || url.pathname !== '/api/auth/verify-email') {
            throw new Error('Unexpected synthetic verification destination')
          }
          // Request native JSON acknowledgement, as the existing auth-recovery test does.
          url.searchParams.delete('callbackURL')
          verificationUrl = url.href
        },
      })
      const bridgeAuth: Parameters<typeof createAuthPlugin>[0] = {
        ...auth,
        api: {
          ...auth.api,
          signUpEmail: async (args) => {
            await auth.api.signUpEmail({ ...args, asResponse: false })
          },
          signOut: async (args) => {
            await auth.api.signOut({ ...args, asResponse: false })
          },
          getSession: async (args) => {
            const result = await auth.api.getSession({
              ...args,
              asResponse: false,
              returnHeaders: false,
            })
            if (result === null) return null
            return z
              .object({
                session: z.record(z.string(), z.unknown()),
                user: z
                  .object({
                    id: z.string(),
                    email: z.string(),
                    emailVerified: z.boolean(),
                    emailVerifiedAt: z.union([z.date(), z.string()]).nullable().optional(),
                    name: z.string().nullable(),
                    image: z.string().nullable(),
                    role: z.string(),
                    createdAt: z.date(),
                    updatedAt: z.date(),
                  })
                  .passthrough(),
              })
              .parse(result)
          },
        },
      }
      server = createAuthPlugin(bridgeAuth)
      await port.release()
      server.listen({ port: port.port, hostname: '127.0.0.1' })
    } finally {
      await port.release()
    }
  })()
  await setup
})

afterAll(async () => {
  await setup?.catch(() => {})
  await operation?.catch(() => {})
  try {
    if (pool)
      await pool.query('DELETE FROM public."user" WHERE email = ANY($1)', [
        [email, changedEmail, spoofEmail, spoofVerifiedEmail],
      ])
  } finally {
    try {
      await server?.stop()
    } finally {
      try {
        await pool?.end()
      } finally {
        try {
          if (databaseCreated)
            await adminPool?.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
        } finally {
          try {
            await adminPool?.end()
          } finally {
            if (previousOrigin === undefined) delete process.env.BETTER_AUTH_URL
            else process.env.BETTER_AUTH_URL = previousOrigin
          }
        }
      }
    }
  }
})

test('returns the authoritative native verification timestamp through the official SDK', async () => {
  operation = (async () => {
    const client = createClient(origin, 'synthetic-anon', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const signup = await client.auth.signUp({
      email,
      password,
      options: { data: { emailVerified: true, emailVerifiedAt: '2000-01-01T00:00:00.000Z' } },
    })
    expect(signup.error).toBeNull()
    expect(signup.data.session).not.toBeNull()
    expect(signup.data.user?.email_confirmed_at).toBeUndefined()
    for (const method of ['PATCH']) {
      const refused = await fetch(`${origin}/auth/v1/user`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: changedEmail, emailVerified: true }),
      })
      expect(refused.status).toBe(401)
      await refused.body?.cancel()
    }
    // Existing supported PATCH route; official SDK PUT update remains tracked separately in #57.
    const patchUser = async (body: { email?: string; data?: Record<string, unknown> }) => {
      const session = await client.auth.getSession()
      const response = await fetch(`${origin}/auth/v1/user`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.data.session?.access_token}`,
        },
        body: JSON.stringify(body),
      })
      const value: unknown = await response.json()
      if (!response.ok) throw new Error('Synthetic authenticated PATCH failed')
      return z.object({ email: z.string(), email_confirmed_at: z.string().optional() }).parse(value)
    }
    const forgedVerified = await fetch(`${origin}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({
        email: spoofVerifiedEmail,
        password,
        name: 'Synthetic',
        emailVerified: true,
      }),
    })
    expect(forgedVerified.status).toBe(200)
    await forgedVerified.body?.cancel()
    if (!pool) throw new Error('Synthetic database fixture unavailable')
    expect(
      (
        await pool.query(
          'SELECT "emailVerified", "emailVerifiedAt" FROM public."user" WHERE email=$1',
          [spoofVerifiedEmail],
        )
      ).rows,
    ).toEqual([{ emailVerified: false, emailVerifiedAt: null }])
    const spoof = await fetch(`${origin}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({
        email: spoofEmail,
        password,
        name: 'Synthetic',
        emailVerified: true,
        emailVerifiedAt: '2000-01-01T00:00:00.000Z',
      }),
    })
    expect(spoof.status).toBe(400)
    await spoof.body?.cancel()
    if (!pool) throw new Error('Synthetic database fixture unavailable')
    expect(
      (await pool.query('SELECT id FROM public."user" WHERE email = $1', [spoofEmail])).rowCount,
    ).toBe(0)
    const unverified = await pool.query<{ emailVerified: boolean; emailVerifiedAt: Date | null }>(
      'SELECT "emailVerified", "emailVerifiedAt" FROM public."user" WHERE email = $1',
      [email],
    )
    expect(unverified.rows).toEqual([{ emailVerified: false, emailVerifiedAt: null }])
    const sent = await fetch(`${origin}/api/auth/send-verification-email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ email }),
    })
    expect(sent.status).toBe(200)
    await sent.body?.cancel()
    expect(typeof verificationUrl).toBe('string')
    if (!verificationUrl) throw new Error('Synthetic verification message was not captured')
    const verified = await fetch(verificationUrl, { redirect: 'manual' })
    expect(verified.status).toBe(200)
    await verified.body?.cancel()
    if (!pool) throw new Error('Synthetic database fixture unavailable')
    const native = await pool.query<{ emailVerified: boolean }>(
      'SELECT "emailVerified" FROM public."user" WHERE email = $1',
      [email],
    )
    expect(native.rows).toEqual([{ emailVerified: true }])
    const current = await client.auth.getUser()
    expect(current.error).toBeNull()
    expect(current.data.user?.email).toBe(email)
    expect(current.data.user?.email_confirmed_at).toEqual(expect.any(String))
    const confirmedAt = current.data.user?.email_confirmed_at
    const stored = await pool.query<{ emailVerifiedAt: Date }>(
      'SELECT "emailVerifiedAt" FROM public."user" WHERE email = $1',
      [email],
    )
    expect(stored.rows[0]?.emailVerifiedAt.toISOString()).toBe(confirmedAt)
    const repeated = await fetch(verificationUrl, { redirect: 'manual' })
    expect(repeated.status).toBe(200)
    await repeated.body?.cancel()
    expect((await client.auth.refreshSession()).data.user?.email_confirmed_at).toBe(confirmedAt)
    expect(
      (await client.auth.signInWithPassword({ email, password })).data.user?.email_confirmed_at,
    ).toBe(confirmedAt)
    const currentSession = await client.auth.getSession()
    const invalidSession = await fetch(`${origin}/auth/v1/user`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: 'Bearer synthetic-invalid' },
      body: JSON.stringify({ email: changedEmail }),
    })
    expect(invalidSession.status).toBe(401)
    await invalidSession.body?.cancel()
    const forgedMetadata = await patchUser({
      data: { emailVerified: false, emailVerifiedAt: '2000-01-01T00:00:00.000Z' },
    })
    expect(forgedMetadata.email_confirmed_at).toBe(confirmedAt)
    expect((await client.auth.getUser()).data.user?.email_confirmed_at).toBe(confirmedAt)
    const legacyPatch = await fetch(`${origin}/auth/v1/user`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${currentSession.data.session?.access_token}`,
      },
      body: JSON.stringify({ email: email.toUpperCase() }),
    })
    expect(legacyPatch.status).toBe(200)
    expect((await legacyPatch.json()).email_confirmed_at).toBe(confirmedAt)
    const unchanged = await patchUser({ email: email.toUpperCase() })
    expect(unchanged.email_confirmed_at).toBe(confirmedAt)
    await createAuthTables(createBetterAuthDB(pool))
    expect((await client.auth.getUser()).data.user?.email_confirmed_at).toBe(confirmedAt)
    const changed = await patchUser({ email: changedEmail })
    expect(changed.email).toBe(changedEmail)
    expect(changed.email_confirmed_at).toBeUndefined()
    const reset = await pool.query<{ emailVerified: boolean; emailVerifiedAt: Date | null }>(
      'SELECT "emailVerified", "emailVerifiedAt" FROM public."user" WHERE email = $1',
      [changedEmail],
    )
    expect(reset.rows).toEqual([{ emailVerified: false, emailVerifiedAt: null }])
    // Re-running the actual schema startup must neither backfill old history nor rewrite new history.
    await createAuthTables(createBetterAuthDB(pool))
    const legacy = await pool.query<{ emailVerified: boolean; emailVerifiedAt: Date | null }>(
      'UPDATE public."user" SET name=$1, "emailVerified"=true WHERE id=$2 RETURNING "emailVerified", "emailVerifiedAt"',
      ['Legacy synthetic', legacyId],
    )
    expect(legacy.rows).toEqual([{ emailVerified: true, emailVerifiedAt: null }])

    // Hold the row while a real authenticated request reads its old address and waits to update.
    const writer = await pool.connect()
    let pendingUpdate: ReturnType<typeof patchUser> | undefined
    try {
      await writer.query('BEGIN')
      const held = await writer.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid FROM public."user" WHERE email = $1 FOR UPDATE',
        [changedEmail],
      )
      expect(held.rows).toHaveLength(1)
      const blockerPid = held.rows[0]?.pid
      if (!blockerPid) throw new Error('Owned row lock unavailable')
      pendingUpdate = patchUser({ email: changedEmail })
      let observed = false
      const deadline = performance.now() + 5000
      while (performance.now() < deadline) {
        const waiting = await pool.query<{ waiting: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
           AND $1::integer = ANY(pg_blocking_pids(pid))) AS waiting`,
          [blockerPid],
        )
        if (waiting.rows[0]?.waiting) {
          observed = true
          break
        }
        await Bun.sleep(10)
      }
      expect(observed).toBe(true)
      // The concurrent trusted provider write changes the address and confirms that address.
      await writer.query('UPDATE public."user" SET email=$1, "emailVerified"=true WHERE email=$2', [
        email,
        changedEmail,
      ])
      await writer.query('COMMIT')
      const stale = await pendingUpdate
      expect(stale.email).toBe(changedEmail)
      expect(stale.email_confirmed_at).toBeUndefined()
      const persisted = await pool.query<{ emailVerified: boolean; emailVerifiedAt: Date | null }>(
        'SELECT "emailVerified", "emailVerifiedAt" FROM public."user" WHERE email=$1',
        [changedEmail],
      )
      expect(persisted.rows).toEqual([{ emailVerified: false, emailVerifiedAt: null }])
    } finally {
      let rollbackFailed = true
      try {
        await writer.query('ROLLBACK')
        rollbackFailed = false
      } finally {
        // Destroy a connection whose rollback failed before draining its blocked request.
        writer.release(rollbackFailed)
        await pendingUpdate?.catch(() => {})
      }
    }
  })()
  await operation
}, 15000)

// #57: exercise the actual native credential store, not an auth mock.
test('official SDK updates native credentials using current_password', async () => {
  operation = (async () => {
    const accountEmail = `sdk-password-${crypto.randomUUID()}@example.test`
    const oldPassword = crypto.randomUUID()
    const newPassword = crypto.randomUUID()
    const client = createClient(origin, 'synthetic-anon', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const signup = await client.auth.signUp({ email: accountEmail, password: oldPassword })
    expect(signup.error).toBeNull()
    expect(signup.data.session).not.toBeNull()
    const update = await client.auth.updateUser({
      password: newPassword,
      current_password: oldPassword,
    })
    expect(update.error).toBeNull()
    expect(update.data.user?.id).toBe(signup.data.user?.id)
    expect(
      (await client.auth.signInWithPassword({ email: accountEmail, password: newPassword })).error,
    ).toBeNull()
    expect(
      (await client.auth.signInWithPassword({ email: accountEmail, password: oldPassword })).error,
    ).not.toBeNull()
  })()
  await operation
})

test('existing PATCH success actually changes the native credential', async () => {
  operation = (async () => {
    const accountEmail = `patch-password-${crypto.randomUUID()}@example.test`
    const oldPassword = crypto.randomUUID()
    const newPassword = crypto.randomUUID()
    const client = createClient(origin, 'synthetic-anon', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const signup = await client.auth.signUp({ email: accountEmail, password: oldPassword })
    expect(signup.error).toBeNull()
    expect(signup.data.session).not.toBeNull()
    const response = await fetch(`${origin}/auth/v1/user`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${signup.data.session?.access_token}`,
      },
      body: JSON.stringify({ password: newPassword, currentPassword: oldPassword }),
    })
    expect(response.status).toBe(200)
    await response.body?.cancel()
    expect(
      (await client.auth.signInWithPassword({ email: accountEmail, password: newPassword })).error,
    ).toBeNull()
    expect(
      (await client.auth.signInWithPassword({ email: accountEmail, password: oldPassword })).error,
    ).not.toBeNull()
  })()
  await operation
})

test('native user updates refuse invalid credentials and roll back storage failure', async () => {
  operation = (async () => {
    const accountEmail = `negative-password-${crypto.randomUUID()}@example.test`
    const oldPassword = crypto.randomUUID()
    const newPassword = crypto.randomUUID()
    const client = createClient(origin, 'synthetic-anon', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const signup = await client.auth.signUp({ email: accountEmail, password: oldPassword })
    expect(signup.error).toBeNull()
    const userId = z.string().uuid().parse(signup.data.user?.id)
    for (const attributes of [
      { password: newPassword },
      { password: newPassword, current_password: 'incorrect-current-password' },
      { password: 'short', current_password: oldPassword },
    ]) {
      expect((await client.auth.updateUser(attributes)).error).not.toBeNull()
      expect(
        (await client.auth.signInWithPassword({ email: accountEmail, password: oldPassword }))
          .error,
      ).toBeNull()
    }
    const session = await client.auth.getSession()
    const conflict = await fetch(`${origin}/auth/v1/user`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.data.session?.access_token}`,
      },
      body: JSON.stringify({
        password: newPassword,
        current_password: oldPassword,
        currentPassword: 'conflicting-alias',
      }),
    })
    expect(conflict.status).toBe(400)
    await conflict.body?.cancel()
    for (const authorization of ['', 'Bearer invalid-synthetic-session']) {
      const denied = await fetch(`${origin}/auth/v1/user`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          ...(authorization ? { authorization } : {}),
        },
        body: JSON.stringify({ password: newPassword, current_password: oldPassword }),
      })
      expect(denied.status).toBe(401)
      await denied.body?.cancel()
    }
    if (!pool) throw new Error('Owned native database unavailable')
    expect((await client.auth.updateUser({ data: { preserved: true } })).error).toBeNull()
    // Actual database failure after the credential write, before profile commit.
    await pool?.query(
      `CREATE FUNCTION fail_native_update_57() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic update failure'; END $$`,
    )
    await pool?.query(
      `CREATE TRIGGER fail_native_update_57 BEFORE UPDATE ON public."user" FOR EACH ROW WHEN (OLD.id = '${userId}') EXECUTE FUNCTION fail_native_update_57()`,
    )
    try {
      const result = await client.auth.updateUser({
        password: newPassword,
        current_password: oldPassword,
        email: `changed-${accountEmail}`,
        data: { preserved: null, partial: true },
      })
      expect(result.error?.status).toBe(500)
      expect(result.error?.message).toBe('User update failed')
    } finally {
      await pool?.query('DROP TRIGGER fail_native_update_57 ON public."user"')
      await pool?.query('DROP FUNCTION fail_native_update_57()')
    }
    expect(
      (await client.auth.signInWithPassword({ email: accountEmail, password: oldPassword })).error,
    ).toBeNull()
    expect(
      (await client.auth.signInWithPassword({ email: accountEmail, password: newPassword })).error,
    ).not.toBeNull()
    expect((await client.auth.getUser()).data.user?.user_metadata).toEqual({ preserved: true })
  })()
  await operation
})

test('native password policy accepts its boundaries and matching aliases', async () => {
  operation = (async () => {
    const accountEmail = `policy-password-${crypto.randomUUID()}@example.test`
    let currentPassword: string = crypto.randomUUID()
    const client = createClient(origin, 'synthetic-anon', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    expect(
      (await client.auth.signUp({ email: accountEmail, password: currentPassword })).error,
    ).toBeNull()
    // The installed native provider's default policy is 8 through 128 characters.
    for (const length of [7, 129]) {
      const rejected = await client.auth.updateUser({
        password: 'x'.repeat(length),
        current_password: currentPassword,
      })
      expect(rejected.error?.status).toBe(400)
      expect(rejected.error?.message).toBe('Password does not meet the configured policy')
      expect(
        (await client.auth.signInWithPassword({ email: accountEmail, password: currentPassword }))
          .error,
      ).toBeNull()
    }
    for (const length of [8, 128]) {
      const nextPassword = 'x'.repeat(length)
      const session = await client.auth.getSession()
      const accepted = await fetch(`${origin}/auth/v1/user`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.data.session?.access_token}`,
        },
        body: JSON.stringify({
          password: nextPassword,
          current_password: currentPassword,
          currentPassword,
        }),
      })
      expect(accepted.status).toBe(200)
      await accepted.body?.cancel()
      expect(
        (await client.auth.signInWithPassword({ email: accountEmail, password: nextPassword }))
          .error,
      ).toBeNull()
      currentPassword = nextPassword
    }
  })()
  await operation
})

test('missing native credential refuses password and profile updates together', async () => {
  operation = (async () => {
    const accountEmail = `missing-credential-${crypto.randomUUID()}@example.test`
    const accountPassword = crypto.randomUUID()
    const client = createClient(origin, 'synthetic-anon', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const signup = await client.auth.signUp({ email: accountEmail, password: accountPassword })
    expect(signup.error).toBeNull()
    const userId = z.string().uuid().parse(signup.data.user?.id)
    if (!pool) throw new Error('Owned native database unavailable')
    const removed = await pool.query(
      'DELETE FROM public.account WHERE "userId"=$1 AND "providerId"=$2 RETURNING id',
      [userId, 'credential'],
    )
    expect(removed.rowCount).toBe(1)
    const rejected = await client.auth.updateUser({
      password: crypto.randomUUID(),
      current_password: accountPassword,
      data: { partial: true },
    })
    expect(rejected.error?.status).toBe(400)
    expect(rejected.error?.message).toBe('Current password is incorrect')
    const read = await client.auth.getUser()
    expect(read.error).toBeNull()
    expect(read.data.user?.user_metadata).toEqual({})
  })()
  await operation
})

test('SDK metadata updates persist without granting authority', async () => {
  operation = (async () => {
    const accountEmail = `metadata-${crypto.randomUUID()}@example.test`
    const accountPassword = crypto.randomUUID()
    const client = createClient(origin, 'synthetic-anon', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const signup = await client.auth.signUp({ email: accountEmail, password: accountPassword })
    expect(signup.error).toBeNull()
    const before = await client.auth.getUser()
    expect(before.error).toBeNull()
    expect(before.data.user).not.toBeNull()
    const data = {
      keep: 'retained',
      remove: 'old',
      nested: { a: 1 },
      role: 'admin',
      emailVerified: true,
      emailVerifiedAt: '2000-01-01T00:00:00.000Z',
    }
    const first = await client.auth.updateUser({ data })
    expect(first.error).toBeNull()
    expect(first.data.user?.user_metadata).toEqual(data)
    expect(first.data.user?.email_confirmed_at).toBeUndefined()
    expect(first.data.user?.role).toBe(before.data.user?.role)
    expect(first.data.user?.app_metadata).toEqual(before.data.user?.app_metadata)
    expect(
      (await client.auth.updateUser({ data: { remove: null, nested: { b: 2 } } })).error,
    ).toBeNull()
    const expected = {
      keep: 'retained',
      nested: { b: 2 },
      role: 'admin',
      emailVerified: true,
      emailVerifiedAt: '2000-01-01T00:00:00.000Z',
    }
    expect((await client.auth.getUser()).data.user?.user_metadata).toEqual(expected)
    const signedIn = await client.auth.signInWithPassword({
      email: accountEmail,
      password: accountPassword,
    })
    expect(signedIn.error).toBeNull()
    expect(signedIn.data.user?.user_metadata).toEqual(expected)
    expect((await client.auth.refreshSession()).data.user?.user_metadata).toEqual(expected)
    const session = await client.auth.getSession()
    const patched = await fetch(`${origin}/auth/v1/user`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.data.session?.access_token}`,
      },
      body: JSON.stringify({ data: { patch: 'saved' } }),
    })
    expect(patched.status).toBe(200)
    await patched.body?.cancel()
    expect((await client.auth.getUser()).data.user?.user_metadata).toEqual({
      ...expected,
      patch: 'saved',
    })
    expect((await client.auth.getUser()).data.user?.email_confirmed_at).toBeUndefined()
    const bearer = session.data.session?.access_token
    expect(bearer).toBeDefined()
    const writeMetadata = (data: Record<string, unknown>) =>
      fetch(`${origin}/auth/v1/user`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
        body: JSON.stringify({ data }),
      })
    const concurrent = await Promise.all([writeMetadata({ left: 1 }), writeMetadata({ right: 2 })])
    for (const response of concurrent) {
      expect(response.status).toBe(200)
      await response.body?.cancel()
    }
    const finalMetadata = { ...expected, patch: 'saved', left: 1, right: 2 }
    expect((await client.auth.getUser()).data.user?.user_metadata).toEqual(finalMetadata)
    if (!pool) throw new Error('Owned native database unavailable')
    await pool.query(
      `UPDATE public.session SET "expiresAt" = now() - interval '1 second' WHERE token = $1`,
      [bearer],
    )
    const expired = await writeMetadata({ forbidden: true })
    expect(expired.status).toBe(401)
    await expired.body?.cancel()
    const persisted = await pool.query(
      'SELECT "userMetadata", role, "emailVerified" FROM public."user" WHERE id = $1',
      [signup.data.user?.id],
    )
    expect(persisted.rows[0].userMetadata).toEqual(finalMetadata)
    expect(persisted.rows[0].role).toBe(before.data.user?.role)
    expect(persisted.rows[0].emailVerified).toBe(false)
  })()
  await operation
})
