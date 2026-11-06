/**
 * Self-service account deletion (sinope#1189): `DELETE /auth/v1/user` over real HTTP with the
 * official supabase-js client signing in. Requires PostgreSQL (TEST_POSTGRES_URL).
 *
 * @new-code-test positive src/apis/auth.ts
 * @new-code-test negative src/apis/auth.ts
 * @new-code-test positive src/tools/auth-better/adapter.ts
 * @new-code-test negative src/tools/auth-better/adapter.ts
 * @new-code-test positive src/tools/auth-better/delete-user.ts
 * @new-code-test negative src/tools/auth-better/delete-user.ts
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
import { Sinopebase } from '~/core/app'
import { requirePostgres, reserveLoopbackPort } from '../harness'

const serviceKey = 'delete-user-test-service-key-at-least-32-chars'
const anonKey = 'delete-user-test-anon-key-at-least-32-chars'
const run = crypto.randomUUID().slice(0, 8)

let pool: pg.Pool
let app: Sinopebase
let origin: string

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: requirePostgres() })
  const port = await reserveLoopbackPort()
  app = new Sinopebase({
    port: port.port,
    postgresUrl: requirePostgres(),
    jwtSecret: 'delete-user-test-jwt-secret-at-least-32-chars',
    serviceRoleKey: serviceKey,
    anonKey,
  })
  await port.release()
  await app.start()
  origin = port.origin
  // Admin provisioning needs the case-insensitive unique address index (see admin-users.ts).
  await pool.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS better_auth_user_email_unique ON public."user" (lower(email))',
  )
})

afterAll(async () => {
  await app?.stop()
  await pool?.end()
})

function call(method: string, path: string, token?: string, body?: unknown) {
  return fetch(`${origin}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

/** A provisioned password user, signed in through supabase-js. */
async function signedInUser(label: string) {
  const email = `${label}-${run}@example.com`
  const password = `Delete-test-${crypto.randomUUID()}`
  const created = await call('POST', '/auth/v1/admin/users', serviceKey, { email, password })
  expect(created.status).toBe(201)
  const id = ((await created.json()) as { user: { id: string } }).user.id
  const client = createClient(origin, anonKey, { auth: { persistSession: false } })
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  expect(error).toBeNull()
  return {
    id,
    email,
    password,
    client,
    accessToken: data.session?.access_token ?? '',
    refreshToken: data.session?.refresh_token ?? '',
  }
}

async function userRow(id: string) {
  const { rows } = await pool.query(
    `SELECT email, name, image, "emailVerified", "userMetadata", "deletedAt" FROM "user" WHERE id = $1`,
    [id],
  )
  return rows[0]
}

const count = async (table: string, column: string, id: string) =>
  Number(
    (await pool.query(`SELECT count(*) FROM "${table}" WHERE "${column}" = $1`, [id])).rows[0]
      .count,
  )

describe('DELETE /auth/v1/user', () => {
  test('a freshly signed-in user deletes their account: the row stays as a tombstone and every way in ends', async () => {
    const user = await signedInUser('leaver')
    await pool.query(
      `UPDATE "user" SET name = 'Leaver', image = 'https://img.example/x.png',
         "userMetadata" = '{"name":"Leaver"}' WHERE id = $1`,
      [user.id],
    )
    await pool.query(
      `INSERT INTO account (id, "userId", "providerId", "accountId") VALUES ($1, $2, 'google', $3)`,
      [crypto.randomUUID(), user.id, `google-${run}`],
    )
    // A second session on another device ends too.
    const other = createClient(origin, anonKey, { auth: { persistSession: false } })
    const second = await other.auth.signInWithPassword({
      email: user.email,
      password: user.password,
    })
    expect(second.error).toBeNull()

    const response = await call('DELETE', '/auth/v1/user', user.accessToken)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({})

    const tombstone = await userRow(user.id)
    expect(tombstone.email).toBe(`deleted-${user.id}@deleted.invalid`)
    expect(tombstone.name).toBeNull()
    expect(tombstone.image).toBeNull()
    expect(tombstone.emailVerified).toBe(false)
    expect(tombstone.userMetadata).toEqual({})
    expect(tombstone.deletedAt).toBeInstanceOf(Date)
    expect(await count('account', 'userId', user.id)).toBe(0)
    expect(await count('session', 'userId', user.id)).toBe(0)
    expect(await count('refresh_tokens', 'user_id', user.id)).toBe(0)

    for (const token of [user.accessToken, second.data.session?.access_token ?? ''])
      expect((await call('GET', '/auth/v1/user', token)).status).toBe(401)
    const refreshed = await call('POST', '/auth/v1/token?grant_type=refresh_token', anonKey, {
      refresh_token: user.refreshToken,
    })
    expect(refreshed.status).toBe(400)
    const again = await createClient(origin, anonKey, {
      auth: { persistSession: false },
    }).auth.signInWithPassword({ email: user.email, password: user.password })
    expect(again.error).not.toBeNull()

    // The address is free again: an operator can invite the person afresh.
    const reprovisioned = await call('POST', '/auth/v1/admin/users', serviceKey, {
      email: user.email,
      password: `Delete-test-${crypto.randomUUID()}`,
    })
    expect(reprovisioned.status).toBe(201)
  })

  test('a session signed in more than ten minutes ago must sign in again first', async () => {
    const user = await signedInUser('stale')
    await pool.query(
      `UPDATE session SET "createdAt" = now() - interval '11 minutes' WHERE "userId" = $1`,
      [user.id],
    )

    const response = await call('DELETE', '/auth/v1/user', user.accessToken)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error_code: 'reauthentication_needed' })
    expect((await userRow(user.id)).deletedAt).toBeNull()
    expect((await call('GET', '/auth/v1/user', user.accessToken)).status).toBe(200)
  })

  test('only a user session can delete: no token, the anon key and the service key are refused', async () => {
    const user = await signedInUser('bystander')
    for (const token of [undefined, anonKey, serviceKey]) {
      const response = await call('DELETE', '/auth/v1/user', token)
      expect(response.status).toBe(401)
    }
    expect((await userRow(user.id)).deletedAt).toBeNull()
  })

  test('a deployment record that restricts the deletion refuses it with 409 and changes nothing', async () => {
    const user = await signedInUser('owner')
    await pool.query(`
      CREATE OR REPLACE FUNCTION public.delete_user_test_restrict() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
          IF NEW."deletedAt" IS NOT NULL AND NEW.id = '${user.id}' THEN
            RAISE EXCEPTION 'still owns a company' USING ERRCODE = 'restrict_violation';
          END IF;
          RETURN NEW;
        END $$;
      CREATE TRIGGER delete_user_test_restrict BEFORE UPDATE ON public."user"
        FOR EACH ROW EXECUTE FUNCTION public.delete_user_test_restrict();
    `)
    try {
      const response = await call('DELETE', '/auth/v1/user', user.accessToken)
      expect(response.status).toBe(409)
      const body = (await response.json()) as { error_code: string; msg: string }
      expect(body.error_code).toBe('user_deletion_restricted')
      expect(body.msg).not.toContain('company')
      expect((await userRow(user.id)).deletedAt).toBeNull()
      expect(await count('account', 'userId', user.id)).toBe(1)
      expect((await call('GET', '/auth/v1/user', user.accessToken)).status).toBe(200)
    } finally {
      await pool.query(`
        DROP TRIGGER delete_user_test_restrict ON public."user";
        DROP FUNCTION public.delete_user_test_restrict();
      `)
    }
  })

  test('a tombstone fails closed: a session or recovery that outlives the deletion opens nothing', async () => {
    const user = await signedInUser('racer')
    const late = await signedInUser('racer-late')
    expect((await call('DELETE', '/auth/v1/user', user.accessToken)).status).toBe(200)
    // A sign-in that committed around the deletion: re-point a live session at the tombstone.
    await pool.query(`UPDATE session SET "userId" = $1 WHERE "userId" = $2`, [user.id, late.id])
    await pool.query(`UPDATE refresh_tokens SET user_id = $1 WHERE user_id = $2`, [
      user.id,
      late.id,
    ])
    expect((await call('GET', '/auth/v1/user', late.accessToken)).status).toBe(401)
    const refreshed = await call('POST', '/auth/v1/token?grant_type=refresh_token', anonKey, {
      refresh_token: late.refreshToken,
    })
    expect(refreshed.status).toBe(400)

    const recover = await call('POST', '/auth/v1/recover', anonKey, {
      email: `deleted-${user.id}@deleted.invalid`,
    })
    expect(recover.status).toBe(200)
    const { rows } = await pool.query(
      `SELECT count(*) FROM verification WHERE value = $1 OR identifier = $2`,
      [user.id, `recovery-sent:${user.id}`],
    )
    expect(Number(rows[0].count)).toBe(0)
  })
})
