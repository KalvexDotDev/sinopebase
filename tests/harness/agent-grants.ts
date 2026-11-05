import type { Pool } from 'pg'

/**
 * The host-app objects agent grants rely on: the API roles, auth.uid(), a
 * tenant membership table, a tenant-scoped table and the tenant-binding check
 * `auth.agent_grant_tenant_allowed(text)` that consent calls.
 */
export async function installAgentGrantFixture(pool: Pool): Promise<void> {
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
}
