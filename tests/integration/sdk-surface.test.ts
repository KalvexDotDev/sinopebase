/**
 * SDK surface integration tests — functions.invoke(), SSR cookie provider,
 * and from() builder completeness.
 *
 * The codex audit found three SDK gaps: functions.invoke() had no test at
 * all, the SSR cookie provider had only unit tests (stubbed fetch), and the
 * from() builder transforms were untested. This suite drives all three
 * through a real backend: SDK → HTTP → auth guard → PostgREST/edge-function
 * routes → PostgreSQL.
 *
 * Edge functions: Sinopebase hardcodes `./functions` as the plugin directory
 * (src/core/app.ts), so test functions are written to that relative path —
 * the same mechanism as tests/plugins/drop-functions/*.test.ts.
 *
 * SSR cookies: the password-grant endpoint returns the better-auth session
 * token in the JSON body (access_token) rather than a Set-Cookie header, so
 * the fake cookie jar carries that token under the `better-auth.session_token`
 * cookie name — the exact value better-auth would have set.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Sinopebase } from '~/core/app'
import { PostgresDatabase } from '~/core/db-postgres'
import { createClient, createServerClient, type SinopebaseClient } from '~/sdk/client'
import type { CookieProvider } from '~/sdk/ssr'
import { requirePostgres, reserveLoopbackPort } from '../harness'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Row types are aliases (not interfaces) so they satisfy the SDK's
// `T extends Record<string, unknown>` constraint on from().
/** Row in the RLS-protected SSR table. */
type RlsRow = {
  id: string
  user_id: string
  body: string
}

/** Row in the plain builder-completeness table. */
type ItemRow = {
  id: string
  name: string
  sort_order: number
}

/** Return shape of the sdk-echo edge function. */
interface EchoResult {
  method?: string
  body?: unknown
  functionName?: string
  requestId?: string
}

// ---------------------------------------------------------------------------
// Cookie jar — SvelteKit-style CookieProvider with an inspectable jar
// ---------------------------------------------------------------------------

class FakeCookieJar implements CookieProvider {
  private jar: { name: string; value: string }[] = []
  readonly persisted: { name: string; value: string; opts?: Record<string, unknown> }[] = []

  /** Seed a cookie, mirroring what better-auth would have set in a browser. */
  seed(name: string, value: string): void {
    this.jar = this.jar.filter((c) => c.name !== name)
    this.jar.push({ name, value })
  }

  getAll(): { name: string; value: string }[] {
    return [...this.jar]
  }

  setAll(cookies: { name: string; value: string; opts?: Record<string, unknown> }[]): void {
    this.persisted.push(...cookies)
    for (const c of cookies) {
      this.jar = this.jar.filter((x) => x.name !== c.name)
      this.jar.push({ name: c.name, value: c.value })
    }
  }
}

// ---------------------------------------------------------------------------
// Edge function fixtures — written to a per-run temp directory so parallel
// suites (drop-functions) never race on the same files.
// ---------------------------------------------------------------------------

const FN_DIR = resolve(tmpdir(), `sinopebase-sdk-surface-fns-${process.pid}`)
const OWN_FN_NAMES = ['sdk-echo']

function writeOwnFunction(name: string, source: string): void {
  mkdirSync(FN_DIR, { recursive: true })
  writeFileSync(join(FN_DIR, `${name}.ts`), source, 'utf-8')
}

function cleanupOwnFunctions(): void {
  for (const name of OWN_FN_NAMES) {
    try {
      rmSync(join(FN_DIR, `${name}.ts`), { force: true })
    } catch {
      /* ok */
    }
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

const anonKey = 'sdk-surface-anon-key-min-32-chars!!!'
const serviceRoleKey = 'sdk-surface-srvc-key-min-32-chars!!!'

let app: Sinopebase
let db: PostgresDatabase
let baseUrl: string
let anonClient: SinopebaseClient
let serviceClient: SinopebaseClient
let serverClientA: SinopebaseClient
let serverClientB: SinopebaseClient
let emptyJarClient: SinopebaseClient
let userAId: string
let userBId: string

/** Sign in via raw fetch and capture the better-auth session token. */
async function signInSessionToken(
  email: string,
  password: string,
): Promise<{ sessionToken: string; userId: string }> {
  const res = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ email, password }),
  })
  expect(res.status).toBe(200)
  // ponytail: the password-grant endpoint returns the session token in the
  // JSON body, not a Set-Cookie header (verified against the live backend).
  // The token IS the better-auth session token, so it goes into the jar under
  // the cookie name better-auth uses.
  const json = (await res.json()) as { access_token: string; user: { id: string } }
  return { sessionToken: json.access_token, userId: json.user.id }
}

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
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;

    -- RLS-protected table: users see only their own rows.
    CREATE TABLE IF NOT EXISTS sdk_ssr_rls_test (
      id text PRIMARY KEY,
      user_id uuid NOT NULL,
      body text NOT NULL
    );
    ALTER TABLE sdk_ssr_rls_test ENABLE ROW LEVEL SECURITY;
    TRUNCATE sdk_ssr_rls_test;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON sdk_ssr_rls_test TO anon, authenticated, service_role;
    DROP POLICY IF EXISTS sdk_ssr_rls_anon ON sdk_ssr_rls_test;
    CREATE POLICY sdk_ssr_rls_anon ON sdk_ssr_rls_test FOR SELECT
      TO anon USING (false);
    DROP POLICY IF EXISTS sdk_ssr_rls_auth ON sdk_ssr_rls_test;
    CREATE POLICY sdk_ssr_rls_auth ON sdk_ssr_rls_test FOR SELECT
      TO authenticated USING (auth.uid() = user_id);

    -- Plain table for the from() builder completeness checks (no RLS).
    CREATE TABLE IF NOT EXISTS sdk_surface_items (
      id text PRIMARY KEY,
      name text NOT NULL,
      sort_order integer NOT NULL
    );
    TRUNCATE sdk_surface_items;
    GRANT SELECT, INSERT, UPDATE, DELETE ON sdk_surface_items TO anon, authenticated, service_role;
  `)

  // Write the edge function before boot (loaded lazily per request).
  cleanupOwnFunctions()
  writeOwnFunction(
    'sdk-echo',
    `
    export const config = { auth: false }
    export default async function handler(req, ctx) {
      // The sandbox reconstructs a real Request, so the body is a stream.
      let parsedBody = null
      if (req.body) {
        try { parsedBody = await req.json() } catch { parsedBody = null }
      }
      return {
        method: req.method,
        body: parsedBody,
        functionName: ctx.functionName,
        requestId: ctx.requestId
      }
    }
  `,
  )

  app = new Sinopebase({
    postgresUrl,
    port: portReservation.port,
    jwtSecret: 'sdk-surface-jwt-secret-min-32-chars!',
    serviceRoleKey,
    anonKey,
    functionsDir: FN_DIR,
  })
  await portReservation.release()
  await app.start()
  baseUrl = portReservation.origin

  serviceClient = createClient(baseUrl, serviceRoleKey)

  // Sign up two users via a dedicated signup client (the anon client must
  // stay session-free so its RLS control query runs as the anon role), then
  // capture real session cookies through the raw password-grant endpoint.
  const signupClient = createClient(baseUrl, anonKey)
  const stamp = Date.now()
  const signUpA = await signupClient.auth.signUp({
    email: `sdk-surface-a-${stamp}@example.com`,
    password: 'sdk-surface-password-123',
  })
  const signUpB = await signupClient.auth.signUp({
    email: `sdk-surface-b-${stamp}@example.com`,
    password: 'sdk-surface-password-123',
  })
  anonClient = createClient(baseUrl, anonKey)
  expect(signUpA.error).toBeNull()
  expect(signUpB.error).toBeNull()

  const signInA = await signInSessionToken(
    `sdk-surface-a-${stamp}@example.com`,
    'sdk-surface-password-123',
  )
  const signInB = await signInSessionToken(
    `sdk-surface-b-${stamp}@example.com`,
    'sdk-surface-password-123',
  )
  userAId = signInA.userId
  userBId = signInB.userId
  expect(userAId).toBe(signUpA.data.session?.user.id ?? '')
  expect(userBId).toBe(signUpB.data.session?.user.id ?? '')

  const jarA = new FakeCookieJar()
  jarA.seed('better-auth.session_token', signInA.sessionToken)
  const jarB = new FakeCookieJar()
  jarB.seed('better-auth.session_token', signInB.sessionToken)
  serverClientA = createServerClient(baseUrl, anonKey, { cookies: jarA })
  serverClientB = createServerClient(baseUrl, anonKey, { cookies: jarB })
  emptyJarClient = createServerClient(baseUrl, anonKey, { cookies: new FakeCookieJar() })

  // Seed rows as service_role (BYPASSRLS): one private row per user.
  const { error: seedError } = await serviceClient.from('sdk_ssr_rls_test').insert([
    { id: 'sdk-ssr-a', user_id: userAId, body: 'private-a' },
    { id: 'sdk-ssr-b', user_id: userBId, body: 'private-b' },
  ])
  expect(seedError).toBeNull()

  // Seed builder rows.
  const { error: itemsError } = await serviceClient.from('sdk_surface_items').insert([
    { id: 'sdk-item-1', name: 'alpha', sort_order: 1 },
    { id: 'sdk-item-2', name: 'beta', sort_order: 2 },
    { id: 'sdk-item-3', name: 'gamma', sort_order: 3 },
  ])
  expect(itemsError).toBeNull()
})

afterAll(async () => {
  await app.stop()
  cleanupOwnFunctions()
})

describe('SDK functions.invoke()', () => {
  it('invokes an edge function with a POST body and unwraps the data envelope', async () => {
    const { data, error } = await anonClient.functions.invoke<EchoResult>('sdk-echo', {
      method: 'POST',
      body: { name: 'World' },
    })

    expect(error).toBeNull()
    expect(data?.method).toBe('POST')
    const echoBody = data?.body as { name: string } | undefined
    expect(echoBody?.name).toBe('World')
    expect(data?.functionName).toBe('sdk-echo')
    expect(data?.requestId).toBeTruthy()
  })

  it('supports GET invocations', async () => {
    const { data, error } = await anonClient.functions.invoke<EchoResult>('sdk-echo', {
      method: 'GET',
    })

    expect(error).toBeNull()
    expect(data?.method).toBe('GET')
    expect(data?.body).toBeNull()
  })

  it('returns a structured error for a missing function', async () => {
    const { data, error } = await anonClient.functions.invoke('sdk-does-not-exist')

    expect(data).toBeNull()
    expect(error?.status).toBe(404)
    expect(error?.message).toContain('not found')
  })
})

describe('SDK SSR cookie provider', () => {
  it('getSession() resolves the session from the better-auth cookie', async () => {
    const { data, error } = await serverClientA.auth.getSession()

    expect(error).toBeNull()
    expect(data?.session?.user.id).toBe(userAId)
    expect(data?.session?.access_token).toBeTruthy()
  })

  it('from().select() sends the cookie session and sees only the user’s RLS rows', async () => {
    const { data, error } = await serverClientA.from<RlsRow>('sdk_ssr_rls_test').select('*')

    expect(error).toBeNull()
    expect(data?.map((r) => r.body)).toEqual(['private-a'])
  })

  it('a second SSR client with the other user’s cookie sees only their rows', async () => {
    const { data, error } = await serverClientB.from<RlsRow>('sdk_ssr_rls_test').select('*')

    expect(error).toBeNull()
    expect(data?.map((r) => r.body)).toEqual(['private-b'])
  })

  it('anon client sees no rows (RLS enforced)', async () => {
    const { data, error } = await anonClient.from<RlsRow>('sdk_ssr_rls_test').select('*')

    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('SSR client without a session cookie falls back to anon and sees no rows', async () => {
    const { data, error } = await emptyJarClient.from<RlsRow>('sdk_ssr_rls_test').select('*')

    expect(error).toBeNull()
    expect(data).toEqual([])
  })
})

describe('SDK from() builder completeness', () => {
  it('.select() with comma-separated columns projects the response', async () => {
    const { data, error } = await anonClient
      .from<ItemRow>('sdk_surface_items')
      .select('name,sort_order')
      .order('sort_order')

    expect(error).toBeNull()
    expect(data?.length).toBe(3)
    expect(data?.[0]).toEqual(expect.objectContaining({ name: 'alpha', sort_order: 1 }))
    expect(Object.keys(data?.[0] ?? {}).sort()).toEqual(['name', 'sort_order'])
  })

  it('.order() with ascending: false returns rows in descending order', async () => {
    const { data, error } = await anonClient
      .from<ItemRow>('sdk_surface_items')
      .select('name')
      .order('sort_order', { ascending: false })

    expect(error).toBeNull()
    expect(data?.map((r) => r.name)).toEqual(['gamma', 'beta', 'alpha'])
  })

  it('.limit() caps the number of rows', async () => {
    const { data, error } = await anonClient
      .from<ItemRow>('sdk_surface_items')
      .select('name')
      .order('sort_order')
      .limit(2)

    expect(error).toBeNull()
    expect(data?.map((r) => r.name)).toEqual(['alpha', 'beta'])
  })

  it('.offset() skips the first rows', async () => {
    const { data, error } = await anonClient
      .from<ItemRow>('sdk_surface_items')
      .select('name')
      .order('sort_order')
      .offset(1)

    expect(error).toBeNull()
    expect(data?.map((r) => r.name)).toEqual(['beta', 'gamma'])
  })

  it('order + limit + offset compose together', async () => {
    const { data, error } = await anonClient
      .from<ItemRow>('sdk_surface_items')
      .select('name')
      .order('name', { ascending: false })
      .limit(2)
      .offset(1)

    expect(error).toBeNull()
    expect(data?.map((r) => r.name)).toEqual(['beta', 'alpha'])
  })
})
