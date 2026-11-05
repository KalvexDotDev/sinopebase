// @new-code-test positive src/apis/agent-grants.ts
// @new-code-test negative src/apis/agent-grants.ts
// @new-code-test positive src/tools/auth-better/agent-grants.ts
// @new-code-test negative src/tools/auth-better/agent-grants.ts
// @new-code-test positive src/tools/auth-better/index.ts
// @new-code-test negative src/tools/auth-better/index.ts
// @new-code-test positive src/core/app.ts
// @new-code-test negative src/core/app.ts
// @new-code-test positive src/core/db-postgres.ts
// @new-code-test negative src/core/db-postgres.ts
// @new-code-test positive src/apis/file.ts
// @new-code-test negative src/apis/file.ts
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createHash, randomBytes } from 'node:crypto'
import type { Pool } from 'pg'
import { reserveLoopbackPort } from '../../tests/harness'
import { Sinopebase } from '../core/app'
import type { PostgresDatabase } from '../core/db-postgres'

const postgresUrl = process.env.TEST_POSTGRES_URL ?? process.env.POSTGRES_URL
const describePostgres = postgresUrl ? describe : describe.skip

const resource = 'http://127.0.0.1:5173/mcp'
const consentUrl = 'http://127.0.0.1:5173/oauth/consent'
const redirectUri = 'http://127.0.0.1:33418/callback'
const member = 'a0981098-0000-4000-8000-000000000001'
const outsider = 'a0981098-0000-4000-8000-000000000002'
const tenantA = 'b0981098-0000-4000-8000-00000000000a'
const tenantB = 'b0981098-0000-4000-8000-00000000000b'
const tenantC = 'b0981098-0000-4000-8000-00000000000c'
const memberSession = 'agent-grant-member-session-token-1098'
const outsiderSession = 'agent-grant-outsider-session-token-1098'

interface Tokens {
  access_token: string
  refresh_token: string
  token_type: string
}

describePostgres('OAuth agent grants (sinope#1098)', () => {
  let app: Sinopebase
  let pool: Pool
  let baseUrl: string

  const json = (path: string, init: RequestInit & { token?: string } = {}) =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      },
    })

  async function registerClient(name: string): Promise<string> {
    const response = await json('/api/auth/oauth2/register', {
      method: 'POST',
      body: JSON.stringify({
        client_name: name,
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      }),
    })
    expect(response.status).toBe(201)
    return ((await response.json()) as { client_id: string }).client_id
  }

  /** Start an authorization; returns the signed query the consent page receives. */
  async function authorize(clientId: string, verifier: string, extra: Record<string, string> = {}) {
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'offline_access',
      state: 'state-1098',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      ...extra,
    })
    const response = await fetch(`${baseUrl}/api/auth/oauth2/authorize?${query}`, {
      redirect: 'manual',
    })
    const location = new URL(response.headers.get('location') ?? '')
    expect(`${location.origin}${location.pathname}`).toBe(consentUrl)
    return location.search.slice(1)
  }

  async function exchange(clientId: string, body: Record<string, string>) {
    return fetch(`${baseUrl}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, ...body }),
    })
  }

  /** Full flow: authorize, consent for `tenant`, exchange the code. */
  async function grant(clientId: string, tenant: string) {
    const verifier = randomBytes(32).toString('base64url')
    const oauthQuery = await authorize(clientId, verifier)
    const consent = await json('/auth/v1/agent-grants', {
      method: 'POST',
      token: memberSession,
      body: JSON.stringify({ oauth_query: oauthQuery, tenant_id: tenant }),
    })
    expect(consent.status).toBe(200)
    const redirect = new URL(((await consent.json()) as { redirect_to: string }).redirect_to)
    const code = redirect.searchParams.get('code') ?? ''
    const response = await exchange(clientId, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    })
    expect(response.status).toBe(200)
    return { code, verifier, tokens: (await response.json()) as Tokens }
  }

  const claims = (token: string) =>
    json('/rest/v1/rpc/agent_grant_test_claims', { method: 'POST', token, body: '{}' })
  const tenantRows = async (token: string) => {
    const response = await json('/rest/v1/agent_grant_test_rows?order=id.asc', { token })
    return {
      status: response.status,
      rows: response.ok ? ((await response.json()) as Array<{ id: string }>) : [],
    }
  }
  const grants = async () =>
    (
      (await (await json('/auth/v1/agent-grants', { token: memberSession })).json()) as {
        grants: Array<{
          id: string
          client_id: string
          client_name: string
          tenant_id: string
          last_used_at: string | null
        }>
      }
    ).grants

  beforeAll(async () => {
    if (!postgresUrl) throw new Error('TEST_POSTGRES_URL required')
    const portReservation = await reserveLoopbackPort()
    app = new Sinopebase({
      postgresUrl,
      port: portReservation.port,
      agentGrants: { resource, consentUrl },
    })
    await portReservation.release()
    await app.start()
    baseUrl = portReservation.origin
    pool = (app.getDatabase() as PostgresDatabase).getPool()
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
      END $$;
      GRANT anon, authenticated, service_role TO CURRENT_USER;
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
        AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
      GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
      CREATE TABLE IF NOT EXISTS agent_grant_test_memberships (user_id uuid, tenant_id text, PRIMARY KEY (user_id, tenant_id));
      CREATE TABLE IF NOT EXISTS agent_grant_test_rows (id text PRIMARY KEY, tenant_id text NOT NULL);
      ALTER TABLE agent_grant_test_rows ENABLE ROW LEVEL SECURITY;
      GRANT SELECT ON agent_grant_test_rows TO authenticated;
      DROP POLICY IF EXISTS member_rows ON agent_grant_test_rows;
      -- Membership plus the grant's tenant claim, as sinope#1095 binds tenant-scoped tables.
      CREATE POLICY member_rows ON agent_grant_test_rows FOR SELECT TO authenticated USING (
        tenant_id IN (SELECT m.tenant_id FROM agent_grant_test_memberships m WHERE m.user_id = auth.uid())
        AND (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id' IS NULL
          OR tenant_id = current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id'));
      CREATE OR REPLACE FUNCTION auth.agent_grant_tenant_allowed(tenant_id text) RETURNS boolean
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
        AS $$ SELECT current_setting('request.jwt.claims', true)::jsonb ->> 'channel' = 'first_party'
          AND EXISTS (SELECT 1 FROM public.agent_grant_test_memberships m
          WHERE m.user_id = auth.uid() AND m.tenant_id = agent_grant_tenant_allowed.tenant_id) $$;
      GRANT EXECUTE ON FUNCTION auth.agent_grant_tenant_allowed(text) TO authenticated;
      CREATE OR REPLACE FUNCTION public.agent_grant_test_claims() RETURNS jsonb LANGUAGE sql STABLE
        AS $$ SELECT current_setting('request.jwt.claims', true)::jsonb $$;
      GRANT EXECUTE ON FUNCTION public.agent_grant_test_claims() TO authenticated;
    `)
    await pool.query(
      `INSERT INTO agent_grant_test_memberships VALUES ($1, $2), ($1, $3) ON CONFLICT DO NOTHING`,
      [member, tenantA, tenantB],
    )
    await pool.query(
      `INSERT INTO agent_grant_test_rows VALUES ('a-row', $1), ('b-row', $2) ON CONFLICT DO NOTHING`,
      [tenantA, tenantB],
    )
    for (const [id, session] of [
      [member, memberSession],
      [outsider, outsiderSession],
    ] as const) {
      await pool.query(
        `INSERT INTO "user" ("id", "email", "emailVerified", "name", "role", "createdAt", "updatedAt")
         VALUES ($1, $2, true, 'Agent grant user', 'user', now(), now())
         ON CONFLICT ("id") DO NOTHING`,
        [id, `${id}@agent-grants.test`],
      )
      await pool.query(
        `INSERT INTO "session" ("id", "userId", "token", "expiresAt", "createdAt", "updatedAt")
         VALUES ($1, $1, $2, now() + interval '1 day', now(), now())
         ON CONFLICT ("id") DO UPDATE SET "expiresAt" = EXCLUDED."expiresAt"`,
        [id, session],
      )
    }
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM "oauthClient" WHERE "name" LIKE 'Agent 1098%'`)
    await app.stop()
  })

  it('publishes RFC 8414 metadata with dynamic registration and S256 PKCE only', async () => {
    const response = await fetch(`${baseUrl}/.well-known/oauth-authorization-server/api/auth`)
    expect(response.status).toBe(200)
    const metadata = (await response.json()) as Record<string, unknown>
    expect(metadata.registration_endpoint).toBe('http://localhost:8090/api/auth/oauth2/register')
    expect(metadata.code_challenge_methods_supported).toEqual(['S256'])
    expect(metadata.grant_types_supported).not.toContain('client_credentials')
  })

  it('issues a token bound to the consented tenant that never carries the first-party channel', async () => {
    const clientId = await registerClient('Agent 1098 claims')
    const { tokens } = await grant(clientId, tenantA)
    expect(tokens.access_token.startsWith('sinope_at_')).toBe(true)

    const tokenClaims = (await (await claims(tokens.access_token)).json()) as Record<
      string,
      unknown
    >
    expect(tokenClaims).toEqual({ sub: member, role: 'authenticated', tenant_id: tenantA })
    // The member's first-party session keeps the channel claim and no tenant.
    expect(await (await claims(memberSession)).json()).toEqual({
      sub: member,
      role: 'authenticated',
      channel: 'first_party',
    })
    // Bound to tenant A: the member's tenant B row stays invisible to the grant.
    expect((await tenantRows(tokens.access_token)).rows.map((row) => row.id)).toEqual(['a-row'])
    expect((await tenantRows(memberSession)).rows.map((row) => row.id)).toEqual(['a-row', 'b-row'])

    const listed = (await grants()).find((entry) => entry.client_id === clientId)
    expect(listed).toMatchObject({ client_name: 'Agent 1098 claims', tenant_id: tenantA })
    expect(listed?.last_used_at).not.toBeNull()
  })

  it('shows the consent screen the client name, only for a signed request and a session', async () => {
    const clientId = await registerClient('Agent 1098 consent screen')
    const oauthQuery = await authorize(clientId, randomBytes(32).toString('base64url'))
    const request = (token: string | undefined, query: string) =>
      json('/auth/v1/agent-grants/request', {
        method: 'POST',
        token,
        body: JSON.stringify({ oauth_query: query }),
      })

    const shown = await request(memberSession, oauthQuery)
    expect(await shown.json()).toEqual({
      client: { client_id: clientId, name: 'Agent 1098 consent screen', uri: null, logo_uri: null },
      scopes: ['offline_access'],
    })
    expect((await request(undefined, oauthQuery)).status).toBe(401)
    const tampered = oauthQuery.replace('state-1098', 'state-evil')
    expect((await request(memberSession, tampered)).status).toBe(400)
    const unparsable = await json('/auth/v1/agent-grants/request', {
      method: 'POST',
      token: memberSession,
      body: '{}',
    })
    expect(unparsable.status).toBe(400)
  })

  it('accepts the configured resource and refuses any other at authorization', async () => {
    const clientId = await registerClient('Agent 1098 resources')
    const verifier = randomBytes(32).toString('base64url')
    const signed = new URLSearchParams(await authorize(clientId, verifier, { resource }))
    expect(signed.get('resource')).toBe(resource)
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      resource: 'https://elsewhere.example/mcp',
    })
    const refused = await fetch(`${baseUrl}/api/auth/oauth2/authorize?${query}`, {
      redirect: 'manual',
    })
    const location = new URL(refused.headers.get('location') ?? '')
    expect(`${location.origin}${location.pathname}`).toBe(redirectUri)
    expect(location.searchParams.get('error')).toBe('invalid_target')
  })

  it('never emits the first-party channel for a tenant-bound context', async () => {
    const db = app.getDatabase() as PostgresDatabase
    const bound = await db.withRequestContext(
      { role: 'authenticated', userId: member, channel: 'first_party', tenantId: tenantA },
      (scoped) => scoped.rpc('agent_grant_test_claims', {}, { singular: true }),
    )
    expect(bound).toEqual({ sub: member, role: 'authenticated', tenant_id: tenantA })
  })

  it('refuses to bind a tenant the user is not a member of, or an unsigned request', async () => {
    const clientId = await registerClient('Agent 1098 outsider')
    const oauthQuery = await authorize(clientId, randomBytes(32).toString('base64url'))
    const accept = (token: string, tenant: string, query = oauthQuery) =>
      json('/auth/v1/agent-grants', {
        method: 'POST',
        token,
        body: JSON.stringify({ oauth_query: query, tenant_id: tenant }),
      })

    expect((await accept(outsiderSession, tenantA)).status).toBe(403)
    expect((await accept(memberSession, tenantC)).status).toBe(403)
    expect((await accept(memberSession, tenantA, `${oauthQuery}x`)).status).toBe(400)
    expect(
      (await json('/auth/v1/agent-grants', { method: 'POST', token: memberSession, body: '{}' }))
        .status,
    ).toBe(400)
    expect((await accept('not-a-session', tenantA)).status).toBe(401)
    const consents = await pool.query(`SELECT 1 FROM "oauthConsent" WHERE "clientId" = $1`, [
      clientId,
    ])
    expect(consents.rowCount).toBe(0)
  })

  it('denies: the client gets access_denied and no grant exists', async () => {
    const clientId = await registerClient('Agent 1098 denied')
    const oauthQuery = await authorize(clientId, randomBytes(32).toString('base64url'))
    const deny = (token: string, body: unknown) =>
      json('/auth/v1/agent-grants/deny', { method: 'POST', token, body: JSON.stringify(body) })

    expect((await deny('not-a-session', { oauth_query: oauthQuery })).status).toBe(401)
    expect((await deny(memberSession, {})).status).toBe(400)
    expect((await deny(memberSession, { oauth_query: `${oauthQuery}x` })).status).toBe(400)
    const denied = await deny(memberSession, { oauth_query: oauthQuery })
    const redirect = new URL(((await denied.json()) as { redirect_to: string }).redirect_to)
    expect(redirect.searchParams.get('error')).toBe('access_denied')
    expect((await grants()).some((entry) => entry.client_id === clientId)).toBe(false)
  })

  it('revoking one grant stops it on the next call; the session and other grants keep working', async () => {
    const clientId = await registerClient('Agent 1098 revoke')
    const inA = await grant(clientId, tenantA)
    const inB = await grant(clientId, tenantB)
    const otherClient = await grant(await registerClient('Agent 1098 other'), tenantA)
    expect((await tenantRows(inA.tokens.access_token)).status).toBe(200)

    const target = (await grants()).find((g) => g.client_id === clientId && g.tenant_id === tenantA)
    const revoke = (token: string, id: string) =>
      json(`/auth/v1/agent-grants/${id}`, { method: 'DELETE', token })
    // Not the outsider's grant, and an agent token cannot manage grants.
    expect((await revoke(outsiderSession, target?.id ?? '')).status).toBe(404)
    expect((await revoke(inA.tokens.access_token, target?.id ?? '')).status).toBe(401)
    expect((await json('/auth/v1/agent-grants', { token: inA.tokens.access_token })).status).toBe(
      401,
    )
    expect((await revoke(memberSession, target?.id ?? '')).status).toBe(204)

    expect((await tenantRows(inA.tokens.access_token)).status).toBe(401)
    const refreshed = await exchange(clientId, {
      grant_type: 'refresh_token',
      refresh_token: inA.tokens.refresh_token,
    })
    expect(refreshed.status).toBe(400)
    expect((await tenantRows(memberSession)).rows.map((row) => row.id)).toEqual(['a-row', 'b-row'])
    expect((await tenantRows(inB.tokens.access_token)).rows.map((row) => row.id)).toEqual(['b-row'])
    expect((await tenantRows(otherClient.tokens.access_token)).rows.map((row) => row.id)).toEqual([
      'a-row',
    ])
  })

  it("keeps a grant's tenant fixed: re-consent for another tenant is a separate grant", async () => {
    const clientId = await registerClient('Agent 1098 fixed tenant')
    const inA = await grant(clientId, tenantA)
    await grant(clientId, tenantB)
    const ids = await pool.query<{ referenceId: string }>(
      `SELECT "referenceId" FROM "oauthConsent" WHERE "clientId" = $1 ORDER BY "referenceId"`,
      [clientId],
    )
    expect(ids.rows.map((row) => row.referenceId)).toEqual([tenantA, tenantB])

    for (const table of ['oauthConsent', 'oauthAccessToken', 'oauthRefreshToken']) {
      const moved = pool.query(
        `UPDATE "${table}" SET "referenceId" = $2 WHERE "clientId" = $1 AND "referenceId" = $3`,
        [clientId, tenantC, tenantA],
      )
      expect(moved).rejects.toMatchObject({ code: '42501' })
      await moved.catch(() => undefined)
    }
    const rotated = await exchange(clientId, {
      grant_type: 'refresh_token',
      refresh_token: inA.tokens.refresh_token,
    })
    const next = (await rotated.json()) as Tokens
    expect((await (await claims(next.access_token)).json()) as object).toMatchObject({
      tenant_id: tenantA,
    })
  })

  it('refuses expired, wrong-audience, replayed and unknown tokens', async () => {
    const clientId = await registerClient('Agent 1098 refusals')
    const first = await grant(clientId, tenantA)
    expect((await tenantRows(first.tokens.access_token)).status).toBe(200)

    // A replayed authorization code is refused, and the tokens it issued stop working.
    const replayedCode = await exchange(clientId, {
      grant_type: 'authorization_code',
      code: first.code,
      redirect_uri: redirectUri,
      code_verifier: first.verifier,
    })
    expect(replayedCode.status).toBe(400)
    expect((await tenantRows(first.tokens.access_token)).status).toBe(401)

    // A replayed (already rotated) refresh token is refused and ends the grant's tokens.
    const second = await grant(clientId, tenantA)
    const rotated = await exchange(clientId, {
      grant_type: 'refresh_token',
      refresh_token: second.tokens.refresh_token,
    })
    expect(rotated.status).toBe(200)
    const third = (await rotated.json()) as Tokens
    expect((await tenantRows(third.access_token)).status).toBe(200)
    const replayed = await exchange(clientId, {
      grant_type: 'refresh_token',
      refresh_token: second.tokens.refresh_token,
    })
    expect(replayed.status).toBe(400)
    expect((await tenantRows(third.access_token)).status).toBe(401)

    const fresh = await grant(clientId, tenantB)
    expect((await tenantRows(fresh.tokens.access_token)).status).toBe(200)
    const hash = createHash('sha256')
      .update(fresh.tokens.access_token.slice('sinope_at_'.length))
      .digest('base64url')
    const setToken = (assignment: string, value: unknown) =>
      pool.query(`UPDATE "oauthAccessToken" SET ${assignment} WHERE token = $1`, [hash, value])
    await setToken(`"resources" = $2::jsonb`, JSON.stringify(['https://elsewhere.example/mcp']))
    expect((await tenantRows(fresh.tokens.access_token)).status).toBe(401)
    await setToken(`"resources" = $2::jsonb`, JSON.stringify([resource]))
    expect((await tenantRows(fresh.tokens.access_token)).status).toBe(200)
    await setToken(`"expiresAt" = $2`, new Date(Date.now() - 1000))
    expect((await tenantRows(fresh.tokens.access_token)).status).toBe(401)
    await setToken(`"expiresAt" = $2`, new Date(Date.now() + 60_000))
    await setToken(`"revoked" = $2`, new Date())
    expect((await tenantRows(fresh.tokens.access_token)).status).toBe(401)
    await setToken(`"revoked" = $2`, null)
    await pool.query(`UPDATE "oauthClient" SET "disabled" = true WHERE "clientId" = $1`, [clientId])
    expect((await tenantRows(fresh.tokens.access_token)).status).toBe(401)
    expect((await tenantRows(`sinope_at_${randomBytes(24).toString('base64url')}`)).status).toBe(
      401,
    )
  })

  it('applies a token only where a session would not: not to the GoTrue user or grant APIs', async () => {
    const clientId = await registerClient('Agent 1098 surfaces')
    const { tokens } = await grant(clientId, tenantA)
    expect((await json('/auth/v1/user', { token: tokens.access_token })).status).toBe(401)
    expect((await json('/auth/v1/agent-grants', { token: tokens.access_token })).status).toBe(401)

    // The protected resource resolves the token to its grant; a session is not a grant.
    const identity = await json('/auth/v1/agent-grant', { token: tokens.access_token })
    expect(await identity.json()).toMatchObject({
      user_id: member,
      tenant_id: tenantA,
      client_id: clientId,
    })
    const notAGrant = await json('/auth/v1/agent-grant', { token: memberSession })
    expect(notAGrant.status).toBe(401)
    expect(notAGrant.headers.get('www-authenticate')).toBe('Bearer error="invalid_token"')
    expect((await json('/auth/v1/agent-grant')).status).toBe(401)
  })

  it('refuses every account, auth and grant mutation to an agent token (sinope#1099)', async () => {
    const clientId = await registerClient('Agent 1098 account')
    const { tokens } = await grant(clientId, tenantA)
    const [listed] = await grants()
    const attempts: Array<[string, string, string?]> = [
      ['PUT', '/auth/v1/user', '{"email":"agent-1099@evil.test"}'],
      ['PUT', '/auth/v1/user', '{"password":"Agent-1099-takeover!"}'],
      ['PATCH', '/auth/v1/user', '{"data":{"name":"Agent"}}'],
      ['POST', '/auth/v1/logout', '{}'],
      ['DELETE', '/auth/v1/user/identities/any'],
      ['GET', '/auth/v1/user/identities/authorize?provider=google'],
      ['POST', '/auth/v1/admin/users', '{"email":"agent-1099@evil.test","password":"x"}'],
      ['POST', '/auth/v1/agent-grants', `{"oauth_query":"x","tenant_id":"${tenantB}"}`],
      ['POST', '/auth/v1/agent-grants/request', '{"oauth_query":"x"}'],
      ['POST', '/auth/v1/agent-grants/deny', '{"oauth_query":"x"}'],
      ['DELETE', `/auth/v1/agent-grants/${listed?.id}`],
      ['POST', '/api/auth/update-user', '{"name":"Agent"}'],
      ['POST', '/api/auth/change-email', '{"newEmail":"agent-1099@evil.test"}'],
      ['POST', '/api/auth/change-password', '{"currentPassword":"x","newPassword":"y"}'],
      ['POST', '/api/auth/revoke-sessions', '{}'],
      ['POST', '/api/auth/delete-user', '{}'],
    ]
    for (const [method, path, body] of attempts) {
      const response = await json(path, { method, token: tokens.access_token, body })
      expect([401, 403], `${method} ${path}`).toContain(response.status)
    }
    const user = await pool.query(`SELECT "email", "name" FROM "user" WHERE "id" = $1`, [member])
    expect(user.rows[0]).toEqual({ email: `${member}@agent-grants.test`, name: 'Agent grant user' })
    expect((await grants()).map((entry) => entry.id)).toContain(listed?.id)
    expect((await json('/auth/v1/user', { token: memberSession })).status).toBe(200)
  })

  it('runs an agent token read-only on REST and RPC, SECURITY DEFINER included (sinope#1099)', async () => {
    await pool.query(`
      GRANT INSERT, UPDATE, DELETE ON agent_grant_test_rows TO authenticated;
      DROP POLICY IF EXISTS member_insert ON agent_grant_test_rows;
      DROP POLICY IF EXISTS member_update ON agent_grant_test_rows;
      DROP POLICY IF EXISTS member_delete ON agent_grant_test_rows;
      CREATE POLICY member_insert ON agent_grant_test_rows FOR INSERT TO authenticated WITH CHECK (
        tenant_id IN (SELECT m.tenant_id FROM agent_grant_test_memberships m WHERE m.user_id = auth.uid()));
      CREATE POLICY member_update ON agent_grant_test_rows FOR UPDATE TO authenticated USING (true);
      CREATE POLICY member_delete ON agent_grant_test_rows FOR DELETE TO authenticated USING (true);
      CREATE OR REPLACE FUNCTION public.agent_grant_test_write(p_id text) RETURNS void
        LANGUAGE sql SECURITY DEFINER SET search_path = ''
        AS $$ INSERT INTO public.agent_grant_test_rows (id, tenant_id) VALUES (p_id, '${tenantA}') $$;
      GRANT EXECUTE ON FUNCTION public.agent_grant_test_write(text) TO authenticated;
    `)
    const clientId = await registerClient('Agent 1098 writer')
    const { tokens } = await grant(clientId, tenantA)
    const write = (token: string, path: string, method: string, body?: unknown) =>
      json(path, { method, token, body: body === undefined ? undefined : JSON.stringify(body) })
    const rows = async () =>
      (await pool.query(`SELECT id FROM agent_grant_test_rows ORDER BY id`)).rows.map(
        (row: { id: string }) => row.id,
      )

    try {
      const refused = [
        await write(tokens.access_token, '/rest/v1/agent_grant_test_rows', 'POST', {
          id: 'agent-row',
          tenant_id: tenantA,
        }),
        await write(tokens.access_token, '/rest/v1/agent_grant_test_rows?id=eq.a-row', 'PATCH', {
          id: 'a-row-renamed',
        }),
        await write(tokens.access_token, '/rest/v1/agent_grant_test_rows?id=eq.a-row', 'DELETE'),
        await write(tokens.access_token, '/rest/v1/rpc/agent_grant_test_write', 'POST', {
          p_id: 'agent-definer-row',
        }),
      ]
      for (const response of refused) {
        expect(response.status).toBe(405)
        expect(((await response.json()) as { code: string }).code).toBe('25006')
      }
      expect(await rows()).toEqual(['a-row', 'b-row'])
      expect((await tenantRows(tokens.access_token)).rows.map((row) => row.id)).toEqual(['a-row'])

      // The same User's first-party session still writes through the same policies.
      const sessionWrite = await write(
        memberSession,
        '/rest/v1/rpc/agent_grant_test_write',
        'POST',
        { p_id: 'session-row' },
      )
      expect(sessionWrite.status).toBeLessThan(300)
      expect(await rows()).toEqual(['a-row', 'b-row', 'session-row'])
    } finally {
      // Restore the shared fixture rows whatever a failed run wrote.
      await pool.query(`DELETE FROM agent_grant_test_rows WHERE id NOT IN ('a-row', 'b-row')`)
      await pool.query(
        `INSERT INTO agent_grant_test_rows VALUES ('a-row', $1) ON CONFLICT DO NOTHING`,
        [tenantA],
      )
    }
  })

  it('refuses every storage write to an agent token before the store changes (sinope#1099)', async () => {
    const bucket = 'agent-grant-1099'
    await pool.query(
      `INSERT INTO storage.buckets (id, name, public) VALUES ($1, $1, false) ON CONFLICT DO NOTHING`,
      [bucket],
    )
    // A fresh folder per run: the local store outlives the database between runs.
    const folder = `${tenantA}/${randomBytes(6).toString('hex')}`
    const kept = `${folder}/kept.txt`
    const upload = (token: string, path: string, body: string, upsert = false) =>
      fetch(`${baseUrl}/storage/v1/object/${bucket}/${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'text/plain',
          ...(upsert ? { 'x-upsert': 'true' } : {}),
        },
        body,
      })
    expect((await upload(memberSession, kept, 'original', true)).status).toBe(200)
    const clientId = await registerClient('Agent 1098 storage')
    const { tokens } = await grant(clientId, tenantA)
    const agent = tokens.access_token

    const refused = [
      await upload(agent, `${folder}/agent.txt`, 'written by an agent'),
      await upload(agent, kept, 'overwritten by an agent', true),
      await json('/storage/v1/object/copy', {
        method: 'POST',
        token: agent,
        body: JSON.stringify({ bucket, from: kept, to: `${folder}/copied.txt` }),
      }),
      await json('/storage/v1/object/move', {
        method: 'POST',
        token: agent,
        body: JSON.stringify({ bucket, from: kept, to: `${folder}/moved.txt` }),
      }),
      await json(`/storage/v1/object/${bucket}`, {
        method: 'DELETE',
        token: agent,
        body: JSON.stringify({ prefixes: [kept] }),
      }),
      await json(`/storage/v1/object/sign/${bucket}/${kept}`, {
        method: 'POST',
        token: agent,
        body: JSON.stringify({ expiresIn: 60, method: 'PUT' }),
      }),
      await json('/storage/v1/bucket', {
        method: 'POST',
        token: agent,
        body: JSON.stringify({ name: `agent-grant-1099-${folder.slice(-12)}` }),
      }),
      await json(`/storage/v1/bucket/${bucket}`, { method: 'DELETE', token: agent }),
    ]
    for (const response of refused) {
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({
        statusCode: '403',
        error: '403',
        message: 'An agent grant is read-only',
      })
    }

    // Reading stays open: a signed download for its own tenant's object.
    const signedGet = await json(`/storage/v1/object/sign/${bucket}/${kept}`, {
      method: 'POST',
      token: agent,
      body: JSON.stringify({ expiresIn: 60 }),
    })
    expect(signedGet.status).toBe(200)

    const store = app.getFileStore()
    if (!store) throw new Error('The file store must be configured')
    expect(Buffer.from(await store.read(bucket, kept)).toString()).toBe('original')
    for (const path of ['agent.txt', 'copied.txt', 'moved.txt'])
      await expect(store.read(bucket, `${folder}/${path}`)).rejects.toBeDefined()
    const objects = await pool.query(
      `SELECT name FROM storage.objects WHERE bucket_id = $1 AND name LIKE $2 ORDER BY name`,
      [bucket, `${folder}/%`],
    )
    expect(objects.rows.map((row: { name: string }) => row.name)).toEqual([kept])
    const buckets = await pool.query(`SELECT 1 FROM storage.buckets WHERE id = $1`, [
      `agent-grant-1099-${folder.slice(-12)}`,
    ])
    expect(buckets.rowCount).toBe(0)
  })

  it('exposes only the OAuth client endpoints and issues no client-credential tokens', async () => {
    for (const path of ['consent', 'continue', 'get-consents', 'update-consent', 'create-client']) {
      const response = await json(`/api/auth/oauth2/${path}`, {
        method: 'POST',
        token: memberSession,
        body: '{}',
      })
      expect(response.status).toBe(404)
    }
    const clientId = await registerClient('Agent 1098 m2m')
    const m2m = await exchange(clientId, { grant_type: 'client_credentials' })
    expect(m2m.status).toBe(400)
  })
})
