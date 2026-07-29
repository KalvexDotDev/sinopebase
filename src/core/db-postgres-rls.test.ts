import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { reserveLoopbackPort } from '../../tests/harness'
import { Sinopebase } from './app'
import { PostgresDatabase } from './db-postgres'

const postgresUrl = process.env.TEST_POSTGRES_URL ?? process.env.POSTGRES_URL
const describePostgres = postgresUrl ? describe : describe.skip

const memberA = '11111111-1111-4111-8111-111111111111'
const memberB = '22222222-2222-4222-8222-222222222222'
const serviceSeedUser = '33333333-3333-4333-8333-333333333333'
const memberAToken = 'sinopebase-rls-member-a-token'

describePostgres('PostgreSQL request RLS context', () => {
  let db: PostgresDatabase
  let app: Sinopebase
  let baseUrl: string

  beforeAll(async () => {
    const portReservation = await reserveLoopbackPort()
    if (!postgresUrl) throw new Error('TEST_POSTGRES_URL required')
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
      CREATE TABLE IF NOT EXISTS sinopebase_rls_context_test (
        id text PRIMARY KEY,
        user_id uuid NOT NULL,
        body text NOT NULL,
        is_public boolean NOT NULL DEFAULT false
      );
      ALTER TABLE sinopebase_rls_context_test ENABLE ROW LEVEL SECURITY;
      GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
      GRANT SELECT, INSERT, UPDATE, DELETE ON sinopebase_rls_context_test TO anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies
          WHERE schemaname = 'public'
            AND tablename = 'sinopebase_rls_context_test'
            AND policyname = 'sinopebase_member_select'
        ) THEN
          CREATE POLICY sinopebase_member_select ON sinopebase_rls_context_test
            FOR SELECT TO authenticated USING (user_id = auth.uid());
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies
          WHERE schemaname = 'public'
            AND tablename = 'sinopebase_rls_context_test'
            AND policyname = 'sinopebase_member_update'
        ) THEN
          CREATE POLICY sinopebase_member_update ON sinopebase_rls_context_test
            FOR UPDATE TO authenticated
            USING (user_id = auth.uid())
            WITH CHECK (user_id = auth.uid());
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies
          WHERE schemaname = 'public'
            AND tablename = 'sinopebase_rls_context_test'
            AND policyname = 'sinopebase_public_select'
        ) THEN
          CREATE POLICY sinopebase_public_select ON sinopebase_rls_context_test
            FOR SELECT TO anon USING (is_public);
        END IF;
      END
      $$;
    `)
    await pool.query(
      `
      INSERT INTO sinopebase_rls_context_test (id, user_id, body, is_public)
      VALUES
        ('member-a', $1, 'A private', false),
        ('member-b', $2, 'B private', false),
        ('public', $2, 'public', true),
        ('signup-service-membership', $3, 'service-created membership', false)
      ON CONFLICT (id) DO UPDATE
        SET user_id = EXCLUDED.user_id,
            body = EXCLUDED.body,
            is_public = EXCLUDED.is_public
    `,
      [memberA, memberB, serviceSeedUser],
    )

    if (!postgresUrl) throw new Error('TEST_POSTGRES_URL required')
    app = new Sinopebase({ postgresUrl, port: portReservation.port })
    await portReservation.release()
    await app.start()
    baseUrl = portReservation.origin
    const appDb = app.getDatabase() as PostgresDatabase
    await appDb.getPool().query(
      `
      INSERT INTO "user" (
        "id", "email", "emailVerified", "name", "role", "createdAt", "updatedAt"
      ) VALUES ($1, 'rls-member-a@sinopebase.test', true, 'RLS member A', 'user', now(), now())
      ON CONFLICT ("id") DO UPDATE SET "updatedAt" = now()
    `,
      [memberA],
    )
    await appDb.getPool().query(
      `
      INSERT INTO "session" (
        "id", "userId", "token", "expiresAt", "createdAt", "updatedAt"
      ) VALUES ('sinopebase-rls-session-a', $1, $2, now() + interval '1 day', now(), now())
      ON CONFLICT ("id") DO UPDATE
        SET "token" = EXCLUDED."token", "expiresAt" = EXCLUDED."expiresAt", "updatedAt" = now()
    `,
      [memberA, memberAToken],
    )
  })

  afterAll(async () => {
    await app.stop()
  })

  it('authenticated member reads only rows allowed by auth.uid()', async () => {
    const rows = await db.withRequestContext(
      { role: 'authenticated', userId: memberA },
      (requestDb) => requestDb.select('sinopebase_rls_context_test'),
    )

    expect(rows.map((row) => row.id)).toEqual(['member-a'])
  })

  it('authenticated member cannot update another member row', async () => {
    const rows = await db.withRequestContext(
      { role: 'authenticated', userId: memberA },
      (requestDb) =>
        requestDb.update(
          'sinopebase_rls_context_test',
          [{ column: 'id', operator: 'eq', value: 'member-b' }],
          { body: 'cross-tenant write' },
        ),
    )

    expect(rows).toEqual([])
  })

  it('anonymous reads execute as anon and see only public rows', async () => {
    const rows = await db.withRequestContext({ role: 'anon' }, (requestDb) =>
      requestDb.select('sinopebase_rls_context_test'),
    )

    expect(rows.map((row) => row.id)).toEqual(['public'])
  })

  it('service role explicitly bypasses RLS', async () => {
    const rows = await db.withRequestContext({ role: 'service_role' }, (requestDb) =>
      requestDb.select('sinopebase_rls_context_test', [], [{ column: 'id' }]),
    )

    expect(rows.map((row) => row.id)).toEqual([
      'member-a',
      'member-b',
      'public',
      'signup-service-membership',
    ])
  })

  it('keeps concurrent member identities isolated between pooled requests', async () => {
    const [rowsA, rowsB] = await Promise.all([
      db.withRequestContext({ role: 'authenticated', userId: memberA }, (requestDb) =>
        requestDb.select('sinopebase_rls_context_test'),
      ),
      db.withRequestContext({ role: 'authenticated', userId: memberB }, (requestDb) =>
        requestDb.select('sinopebase_rls_context_test', [], [{ column: 'id' }]),
      ),
    ])

    expect(rowsA.map((row) => row.id)).toEqual(['member-a'])
    expect(rowsB.map((row) => row.id)).toEqual(['member-b', 'public'])
  })

  it('applies verified HTTP auth, anon, and service contexts to PostgREST', async () => {
    const request = (token: string) =>
      fetch(`${baseUrl}/rest/v1/sinopebase_rls_context_test?order=id.asc`, {
        headers: { authorization: `Bearer ${token}` },
      }).then((response) => response.json())

    const [memberRows, anonRows, serviceRows] = (await Promise.all([
      request(memberAToken),
      request(process.env.SINOPEBASE_ANON_KEY ?? 'test-anon-key'),
      request(process.env.SINOPEBASE_SERVICE_ROLE_KEY ?? 'test-service-role-key'),
    ])) as Array<Array<{ id: string }>>

    expect(memberRows.map((row) => row.id)).toEqual(['member-a'])
    expect(anonRows.map((row) => row.id)).toEqual(['public'])
    expect(serviceRows.map((row) => row.id)).toEqual([
      'member-a',
      'member-b',
      'public',
      'signup-service-membership',
    ])
  })

  it('lets a signed-up user read a service-created row allowed by auth.uid()', async () => {
    const email = 'rls-signup-service-read@sinopebase.test'
    const password = 'sinopebase-rls-test-password'
    const authHeaders = { 'content-type': 'application/json' }

    let authResponse = await fetch(`${baseUrl}/auth/v1/signup`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ email, password }),
    })
    if (authResponse.status === 400) {
      authResponse = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ email, password }),
      })
    }

    expect(authResponse.ok).toBe(true)
    const session = (await authResponse.json()) as {
      access_token: string
      user: { id: string }
    }
    expect(session.user.id).toMatch(/^[0-9a-f-]{36}$/i)

    const rowId = 'signup-service-membership'
    const serviceResponse = await fetch(`${baseUrl}/rest/v1/sinopebase_rls_context_test`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.SINOPEBASE_SERVICE_ROLE_KEY ?? 'test-service-role-key'}`,
        'content-type': 'application/json',
        prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify({
        id: rowId,
        user_id: session.user.id,
        body: 'service-created membership',
        is_public: false,
      }),
    })
    expect(serviceResponse.ok).toBe(true)

    const memberResponse = await fetch(
      `${baseUrl}/rest/v1/sinopebase_rls_context_test?id=eq.${rowId}`,
      { headers: { authorization: `Bearer ${session.access_token}` } },
    )
    expect(memberResponse.ok).toBe(true)
    expect(await memberResponse.json()).toEqual([
      expect.objectContaining({ id: rowId, user_id: session.user.id }),
    ])
  })

  it('applies the same RLS context to PostgREST HEAD counts', async () => {
    const count = (token: string) =>
      fetch(`${baseUrl}/rest/v1/sinopebase_rls_context_test`, {
        method: 'HEAD',
        headers: { authorization: `Bearer ${token}` },
      }).then((response) => response.headers.get('content-range'))

    const [memberCount, anonCount, serviceCount] = await Promise.all([
      count(memberAToken),
      count(process.env.SINOPEBASE_ANON_KEY ?? 'test-anon-key'),
      count(process.env.SINOPEBASE_SERVICE_ROLE_KEY ?? 'test-service-role-key'),
    ])

    expect(memberCount).toBe('*/1')
    expect(anonCount).toBe('*/1')
    expect(serviceCount).toBe('*/4')
  })
})
