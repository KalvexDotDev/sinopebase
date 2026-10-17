/**
 * Real HTTP/SDK success, overload refusal, and permission/RLS contracts.
 * @new-code-test positive src/core/db-postgres.ts
 * @new-code-test negative src/core/db-postgres.ts
 * @new-code-test positive src/core/db-interface.ts
 * @new-code-test negative src/core/db-interface.ts
 * @new-code-test positive src/apis/postgrest.ts
 * @new-code-test negative src/apis/postgrest.ts
 * @new-code-test positive src/sdk/database.ts
 * @new-code-test negative src/sdk/database.ts
 * @new-code-test positive src/sdk/client.ts
 * @new-code-test negative src/sdk/client.ts
 */
/**
 * RPC ATDD Tests — supabase-js `rpc()` contract at the SDK root.
 *
 * Verifies the root-level client.rpc() call shape, row/scalar/head returns,
 * and RLS role propagation (anon vs authenticated) end-to-end through the
 * real backend: SDK → HTTP → auth guard → PostgREST route → PostgreSQL.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { Sinopebase } from '~/core/app'
import { PostgresDatabase } from '~/core/db-postgres'
import { createClient, type SinopebaseClient } from '~/sdk/client'
import { createClient as createPackagedClient } from '../../sdk-package/src/client'
import { requirePostgres, reserveLoopbackPort } from '../harness'

interface RpcTestRow {
  id: string
  user_id: string
  body: string
  is_public: boolean
}

let app: Sinopebase
let db: PostgresDatabase
let baseUrl: string
let anonClient: SinopebaseClient
let serviceClient: SinopebaseClient
let userAClient: SinopebaseClient
let userBClient: SinopebaseClient
let userAId: string
let userBId: string

const anonKey = 'rpc-anon-key-min-32-chars!!!!!!!'
const serviceRoleKey = 'rpc-srvc-key-min-32-chars!!!!!!!'

beforeAll(async () => {
  const portReservation = await reserveLoopbackPort()
  const postgresUrl = requirePostgres()

  db = new PostgresDatabase({ postgresUrl })
  await db.connect()
  const pool = db.getPool()
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
      END IF;
    END
    $$;
    GRANT anon, authenticated, service_role TO CURRENT_USER;
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE TABLE IF NOT EXISTS rpc_rls_test (
      id text PRIMARY KEY,
      user_id uuid NOT NULL,
      body text NOT NULL,
      is_public boolean NOT NULL DEFAULT false
    );
    ALTER TABLE rpc_rls_test ENABLE ROW LEVEL SECURITY;
    TRUNCATE rpc_rls_test;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON rpc_rls_test TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
    DROP POLICY IF EXISTS rpc_rls_test_anon ON rpc_rls_test;
    CREATE POLICY rpc_rls_test_anon ON rpc_rls_test FOR SELECT
      TO anon USING (is_public);
    DROP POLICY IF EXISTS rpc_rls_test_auth ON rpc_rls_test;
    CREATE POLICY rpc_rls_test_auth ON rpc_rls_test FOR SELECT
      TO authenticated USING (auth.uid() = user_id OR is_public);
    CREATE OR REPLACE FUNCTION rpc_own_rows() RETURNS SETOF rpc_rls_test
    LANGUAGE sql STABLE AS $$ SELECT * FROM rpc_rls_test $$;
    GRANT EXECUTE ON FUNCTION rpc_own_rows() TO anon, authenticated, service_role;
    CREATE OR REPLACE FUNCTION rpc_visible_count() RETURNS integer
    LANGUAGE sql STABLE AS $$ SELECT count(*)::int FROM rpc_rls_test $$;
    GRANT EXECUTE ON FUNCTION rpc_visible_count() TO anon, authenticated, service_role;
    CREATE OR REPLACE FUNCTION rpc_add(a integer, b integer) RETURNS integer
    LANGUAGE sql IMMUTABLE AS $$ SELECT a + b $$;
    GRANT EXECUTE ON FUNCTION rpc_add(integer, integer) TO anon, authenticated, service_role;
    CREATE OR REPLACE FUNCTION rpc_echo_text(t text) RETURNS text
    LANGUAGE sql IMMUTABLE AS $$ SELECT t $$;
    GRANT EXECUTE ON FUNCTION rpc_echo_text(text) TO anon, authenticated, service_role;
    CREATE OR REPLACE FUNCTION rpc_is_null(v text) RETURNS boolean
    LANGUAGE sql IMMUTABLE AS $$ SELECT v IS NULL $$;
    GRANT EXECUTE ON FUNCTION rpc_is_null(text) TO anon, authenticated, service_role;
    CREATE OR REPLACE FUNCTION rpc_scalar_uuid() RETURNS uuid
    LANGUAGE sql AS $$ SELECT '00000000-0000-4000-8000-000000000001'::uuid $$;
    CREATE OR REPLACE FUNCTION rpc_scalar_json() RETURNS jsonb
    LANGUAGE sql AS $$ SELECT '{"items":[1],"flag":false}'::jsonb $$;
    CREATE OR REPLACE FUNCTION rpc_json_array() RETURNS jsonb
    LANGUAGE sql AS $$ SELECT '[{"value":7}]'::jsonb $$;
    GRANT EXECUTE ON FUNCTION rpc_json_array() TO anon, authenticated, service_role;
    CREATE OR REPLACE FUNCTION rpc_scalar_null() RETURNS text
    LANGUAGE sql AS $$ SELECT NULL::text $$;
    CREATE OR REPLACE FUNCTION rpc_one_column() RETURNS TABLE(value integer)
    LANGUAGE sql AS $$ SELECT 7 $$;
    CREATE OR REPLACE FUNCTION rpc_one_scalar_set() RETURNS SETOF integer
    LANGUAGE sql AS $$ SELECT 7 $$;
    CREATE OR REPLACE FUNCTION rpc_default(prefix text DEFAULT 'hello') RETURNS text
    LANGUAGE sql AS $$ SELECT prefix || ' world' $$;
    CREATE OR REPLACE FUNCTION rpc_inout(INOUT value integer)
    LANGUAGE sql AS $$ SELECT value + 1 $$;
    CREATE OR REPLACE FUNCTION rpc_named_shape(number_arg integer) RETURNS integer
    LANGUAGE sql AS $$ SELECT number_arg $$;
    CREATE OR REPLACE FUNCTION rpc_named_shape(text_arg text) RETURNS TABLE(value text)
    LANGUAGE sql AS $$ SELECT text_arg $$;
    DROP FUNCTION IF EXISTS rpc_composite();
    DROP FUNCTION IF EXISTS rpc_composite_set();
    DROP FUNCTION IF EXISTS rpc_composite_domain();
    DROP DOMAIN IF EXISTS rpc_point_domain;
    DROP TYPE IF EXISTS rpc_point;
    CREATE TYPE rpc_point AS (x integer, y integer);
    CREATE DOMAIN rpc_point_domain AS rpc_point;
    CREATE FUNCTION rpc_composite() RETURNS rpc_point LANGUAGE sql AS $$ SELECT (1,2)::rpc_point $$;
    CREATE FUNCTION rpc_composite_set() RETURNS SETOF rpc_point LANGUAGE sql AS $$ SELECT (1,2)::rpc_point $$;
    CREATE FUNCTION rpc_composite_domain() RETURNS rpc_point_domain LANGUAGE sql AS $$ SELECT (1,2)::rpc_point_domain $$;
    GRANT EXECUTE ON FUNCTION rpc_composite(), rpc_composite_set(), rpc_composite_domain() TO anon, authenticated, service_role;
    CREATE OR REPLACE FUNCTION rpc_out(input integer, OUT value integer)
    LANGUAGE sql AS $$ SELECT input + 1 $$;
    CREATE OR REPLACE FUNCTION rpc_default_overlap(a integer) RETURNS integer
    LANGUAGE sql AS $$ SELECT a $$;
    CREATE OR REPLACE FUNCTION rpc_default_overlap(a integer, b text DEFAULT 'default') RETURNS text
    LANGUAGE sql AS $$ SELECT a::text || b $$;
    GRANT EXECUTE ON FUNCTION rpc_out(integer), rpc_default_overlap(integer), rpc_default_overlap(integer,text)
      TO anon, authenticated, service_role;
    CREATE TABLE IF NOT EXISTS rpc_invocation_count(value integer);
    TRUNCATE rpc_invocation_count;
    GRANT INSERT, SELECT ON rpc_invocation_count TO anon, authenticated, service_role;
    CREATE OR REPLACE FUNCTION rpc_once() RETURNS integer
    LANGUAGE plpgsql AS $$ BEGIN INSERT INTO rpc_invocation_count VALUES(1); RETURN 1; END $$;
    CREATE OR REPLACE FUNCTION rpc_ambiguous(value integer) RETURNS integer
    LANGUAGE plpgsql AS $$ BEGIN INSERT INTO rpc_invocation_count VALUES(2); RETURN value; END $$;
    CREATE OR REPLACE FUNCTION rpc_ambiguous(value text) RETURNS text
    LANGUAGE plpgsql AS $$ BEGIN INSERT INTO rpc_invocation_count VALUES(2); RETURN value; END $$;
    GRANT EXECUTE ON FUNCTION rpc_scalar_uuid(), rpc_scalar_json(), rpc_scalar_null(),
      rpc_one_column(), rpc_one_scalar_set(), rpc_default(text), rpc_inout(integer),
      rpc_named_shape(integer), rpc_named_shape(text), rpc_once(),
      rpc_ambiguous(integer), rpc_ambiguous(text) TO anon, authenticated, service_role;
    CREATE OR REPLACE FUNCTION rpc_empty() RETURNS SETOF rpc_rls_test
    LANGUAGE sql STABLE AS $$ SELECT * FROM rpc_rls_test WHERE false $$;
    GRANT EXECUTE ON FUNCTION rpc_empty() TO anon, authenticated, service_role;
  `)

  app = new Sinopebase({
    postgresUrl,
    port: portReservation.port,
    jwtSecret: 'rpc-test-jwt-secret-min-32-chars!',
    serviceRoleKey,
    anonKey,
  })
  await portReservation.release()
  await app.start()
  baseUrl = portReservation.origin

  anonClient = createClient(baseUrl, anonKey)
  serviceClient = createClient(baseUrl, serviceRoleKey)

  // Sign up two users with their own clients — signUp stores the session in
  // memory, so subsequent rpc() calls send the user's access token.
  userAClient = createClient(baseUrl, anonKey)
  userBClient = createClient(baseUrl, anonKey)
  const stamp = Date.now()
  const signUpA = await userAClient.auth.signUp({
    email: `rpc-a-${stamp}@example.com`,
    password: 'rpc-test-password-123',
  })
  const signUpB = await userBClient.auth.signUp({
    email: `rpc-b-${stamp}@example.com`,
    password: 'rpc-test-password-123',
  })
  expect(signUpA.error).toBeNull()
  expect(signUpB.error).toBeNull()
  userAId = signUpA.data.session?.user.id ?? ''
  userBId = signUpB.data.session?.user.id ?? ''
  expect(userAId).not.toBe('')
  expect(userBId).not.toBe('')

  // Seed rows as service_role (BYPASSRLS).
  const { error: seedError } = await serviceClient.from('rpc_rls_test').insert([
    { id: 'rpc-seed-a', user_id: userAId, body: 'private-a', is_public: false },
    { id: 'rpc-seed-b', user_id: userBId, body: 'private-b', is_public: false },
    { id: 'rpc-seed-pub', user_id: userAId, body: 'public-row', is_public: true },
  ])
  expect(seedError).toBeNull()
})

afterAll(async () => {
  await app.stop()
})

describe('SDK rpc() — supabase-js contract', () => {
  it('root client.rpc() returns rows and respects RLS for the signed-in user', async () => {
    const { data, error } = await userAClient.rpc<RpcTestRow[]>('rpc_own_rows')

    expect(error).toBeNull()
    expect(data?.map((r) => r.body).sort()).toEqual(['private-a', 'public-row'])
  })

  it('user B sees only their own rows plus public rows', async () => {
    const { data, error } = await userBClient.rpc<RpcTestRow[]>('rpc_own_rows')

    expect(error).toBeNull()
    expect(data?.map((r) => r.body).sort()).toEqual(['private-b', 'public-row'])
  })

  it('anon rpc sees only public rows', async () => {
    const { data, error } = await anonClient.rpc<RpcTestRow[]>('rpc_own_rows')

    expect(error).toBeNull()
    expect(data?.map((r) => r.body).sort()).toEqual(['public-row'])
  })

  it('scalar functions return a single value with { get: true } and honor RLS', async () => {
    const { data: anonCount, error: anonError } = await anonClient.rpc<number>(
      'rpc_visible_count',
      {},
      { get: true },
    )
    expect(anonError).toBeNull()
    expect(anonCount).toBe(1)

    const { data: userACount, error: userAError } = await userAClient.rpc<number>(
      'rpc_visible_count',
      {},
      { get: true },
    )
    expect(userAError).toBeNull()
    expect(userACount).toBe(2)
  })

  it('{ head: true } returns status without a body', async () => {
    const { data, error, status } = await userAClient.rpc('rpc_visible_count', {}, { head: true })

    expect(error).toBeNull()
    expect(data).toBeNull()
    expect(status).toBe(200)
  })

  it('from().rpc() still works (backwards compat)', async () => {
    const { data, error } = await anonClient.from('rpc_rls_test').rpc<RpcTestRow[]>('rpc_own_rows')

    expect(error).toBeNull()
    expect(data?.map((r) => r.body)).toEqual(['public-row'])
  })

  it('unknown functions surface the backend 404 as an error', async () => {
    const { data, error } = await anonClient.rpc('rpc_no_such_fn')

    expect(data).toBeNull()
    expect(error?.code).toBe('404')
    expect(error?.message).toContain('does not exist')
  })

  it('functions with arguments return the computed value', async () => {
    const { data, error } = await anonClient.rpc<number>('rpc_add', { a: 2, b: 3 }, { get: true })

    expect(error).toBeNull()
    expect(data).toBe(5)
  })

  it('string arguments arrive unquoted', async () => {
    const { data, error } = await anonClient.rpc<string>(
      'rpc_echo_text',
      { t: 'hello' },
      { get: true },
    )

    expect(error).toBeNull()
    expect(data).toBe('hello')
  })

  it('null arguments arrive as SQL NULL', async () => {
    const { data, error } = await anonClient.rpc<boolean>('rpc_is_null', { v: null }, { get: true })

    expect(error).toBeNull()
    expect(data).toBe(true)
  })

  // get must not alter cardinality. Actual GET transport remains a separate compatibility gap.
  it('{ get: true } preserves an empty set', async () => {
    const { data, error } = await anonClient.rpc<RpcTestRow[]>('rpc_empty', {}, { get: true })
    expect(error).toBeNull()
    expect(data).toEqual([])
  })
  it('{ get: true } preserves multiple rows', async () => {
    const { data, error } = await serviceClient.rpc<RpcTestRow[]>('rpc_own_rows', {}, { get: true })
    expect(error).toBeNull()
    expect(data).toHaveLength(3)
  })

  it('pg_catalog built-ins are not reachable through rpc', async () => {
    const { data, error } = await anonClient.rpc('version')

    expect(data).toBeNull()
    expect(error?.code).toBe('404')
  })

  it('rejects invalid RPC argument names with 400', async () => {
    const { error } = await anonClient.rpc('rpc_add', { 'a; DROP TABLE rpc_rls_test': 1 })

    expect(error?.code).toBe('400')
  })

  it('{ head: true } still reports failures', async () => {
    const { data, error } = await anonClient.rpc('rpc_no_such_fn', {}, { head: true })

    expect(data).toBeNull()
    expect(error?.code).toBe('404')
  })

  it('rejects table names that traverse out of /rest/v1/', async () => {
    const { data, error } = await anonClient.from('../../auth/v1/user').select('*')

    expect(data).toBeNull()
    expect(error?.code).toBe('INVALID_TABLE')
  })

  it('functions without an explicit GRANT are not executable by anon', async () => {
    // Created as the pool role after app start, so the migration's
    // default-privileges revoke applies: no PUBLIC EXECUTE unless the
    // owner grants it explicitly.
    await db.getPool().query(`
      DROP FUNCTION IF EXISTS rpc_no_grant();
      CREATE FUNCTION rpc_no_grant() RETURNS integer
      LANGUAGE sql AS $$ SELECT 42 $$;
    `)

    const { data, error } = await anonClient.rpc<number>('rpc_no_grant', {}, { get: true })

    // The migration revoked PUBLIC EXECUTE, so this function has no grant for
    // anon — the call must fail. PostgREST parity: PG errors surface as 4xx
    // with their real code instead of a masked 500.
    expect(data).toBeNull()
    expect(error?.code).toBe('42501')
  })
})

// The HTTP contract must work without the bundled SDK's legacy GET unwrapping.
describe('RPC return contracts (#54)', () => {
  async function post(fn: string, args: Record<string, unknown> = {}) {
    const response = await fetch(`${baseUrl}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    })
    return { status: response.status, body: await response.json() }
  }

  it.each([
    ['rpc_scalar_uuid', {}, '00000000-0000-4000-8000-000000000001'],
    ['rpc_echo_text', { t: 'hello' }, 'hello'],
    ['rpc_add', { a: 2, b: 3 }, 5],
    ['rpc_is_null', { v: null }, true],
    ['rpc_scalar_null', {}, null],
    ['rpc_json_array', {}, [{ value: 7 }]],
    ['rpc_scalar_json', {}, { items: [1], flag: false }],
    ['rpc_one_column', {}, [{ value: 7 }]],
    ['rpc_one_scalar_set', {}, [7]],
    ['rpc_composite', {}, { x: 1, y: 2 }],
    ['rpc_composite_set', {}, [{ x: 1, y: 2 }]],
    ['rpc_composite_domain', {}, { x: 1, y: 2 }],
    ['rpc_default', {}, 'hello world'],
    ['rpc_default', { prefix: 'goodbye' }, 'goodbye world'],
    ['rpc_inout', { value: 4 }, 5],
    ['rpc_out', { input: 4 }, 5],
    ['rpc_default_overlap', { a: 2, b: 'chosen' }, '2chosen'],
    ['rpc_named_shape', { number_arg: 3 }, 3],
    ['rpc_named_shape', { text_arg: 'three' }, [{ value: 'three' }]],
  ] as const)('%s retains its declared return shape', async (fn, args, expected) => {
    expect(await post(fn, args)).toEqual({ status: 200, body: expected })
    const official = createSupabaseClient(baseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const response = await official.rpc(fn, args)
    expect(response.error).toBeNull()
    expect(response.data).toEqual(expected)
  })

  it('invokes a mutating scalar once and rejects ambiguous overloads before invoking either', async () => {
    expect(await post('rpc_once')).toEqual({ status: 200, body: 1 })
    const ambiguous = await post('rpc_ambiguous', { value: '2' })
    expect(ambiguous.status).toBe(300)
    expect(ambiguous.body.code).toBe('PGRST203')
    // Upstream findProc matches both required/default-name candidates: no arity preference.
    const overlap = await post('rpc_default_overlap', { a: 2 })
    expect(overlap.status).toBe(300)
    expect(overlap.body.code).toBe('PGRST203')
    const count = await db.getPool().query('SELECT value FROM rpc_invocation_count')
    expect(count.rows).toEqual([{ value: 1 }])
  })

  it.each([{}, { get: true }])(
    'bundled options %j preserve scalar, null, JSON and row-array responses',
    async (options) => {
      for (const client of [anonClient, createPackagedClient(baseUrl, anonKey)]) {
        expect((await client.rpc('rpc_scalar_uuid', {}, options)).data).toBe(
          '00000000-0000-4000-8000-000000000001',
        )
        expect((await client.rpc('rpc_scalar_null', {}, options)).data).toBeNull()
        expect((await client.rpc('rpc_scalar_json', {}, options)).data).toEqual({
          items: [1],
          flag: false,
        })
        expect((await client.rpc('rpc_json_array', {}, options)).data).toEqual([{ value: 7 }])
        expect((await client.rpc('rpc_one_column', {}, options)).data).toEqual([{ value: 7 }])
      }
    },
  )
})
