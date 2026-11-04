// ---------------------------------------------------------------------------
// Agent grants: OAuth 2.1 access for External Agents (sinope#1098)
//
// Better Auth's OAuth Provider issues opaque access tokens to dynamically
// registered MCP clients. A grant is one consent row: one User, one client and
// one tenant (`referenceId`), fixed when the User consents and never changed
// afterwards. Every token carries its grant's tenant, so a request made with
// one runs as that User with a `tenant_id` claim and never the first-party
// channel claim.
// ---------------------------------------------------------------------------

import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { oauthProvider } from '@better-auth/oauth-provider'
import { type Kysely, sql } from 'kysely'
import { z } from 'zod'
import type { BetterAuthDatabase } from './adapter'

export interface AgentGrantOptions {
  /** The RFC 8707 resource (the MCP endpoint) every agent token is issued for. */
  resource: string
  /** Absolute URL of the relying app's sign-in and consent page. */
  consentUrl: string
}

/** Opaque agent access tokens carry this prefix; Better Auth stores only the hash of the rest. */
export const AGENT_ACCESS_TOKEN_PREFIX = 'sinope_at_'
const AGENT_REFRESH_TOKEN_PREFIX = 'sinope_rt_'

/** HTTPS, or plain HTTP only on a loopback host for local development. */
const grantUrl = z
  .string()
  .url({ abort: true })
  .refine((value) => {
    const url = new URL(value)
    return (
      !url.username &&
      !url.password &&
      !url.hash &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    )
  }, 'use an HTTPS URL (or loopback HTTP) without credentials or fragment')

/**
 * Agent grants from SINOPEBASE_AGENT_GRANT_RESOURCE and
 * SINOPEBASE_AGENT_GRANT_CONSENT_URL. Neither set: no OAuth provider. Exactly
 * one set, or an invalid URL: refuse to start rather than run half-configured.
 */
export function agentGrantsFromEnv(env: Record<string, string | undefined>) {
  const resource = env.SINOPEBASE_AGENT_GRANT_RESOURCE || undefined
  const consentUrl = env.SINOPEBASE_AGENT_GRANT_CONSENT_URL || undefined
  if (!resource && !consentUrl) return undefined
  const parsed = z
    .object({ resource: grantUrl, consentUrl: grantUrl })
    .safeParse({ resource, consentUrl })
  if (!parsed.success) {
    throw new Error(
      `Agent grants need both SINOPEBASE_AGENT_GRANT_RESOURCE and SINOPEBASE_AGENT_GRANT_CONSENT_URL: ${parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`,
    )
  }
  return parsed.data satisfies AgentGrantOptions
}

/** Last-used timestamps move at most this often, so a busy agent does not write per request. */
const LAST_USED_RESOLUTION = '1 minute'

/**
 * The tenant a consent request binds. Only the agent-grant consent route sets
 * it; anywhere else the provider resolves no tenant, finds no consent and
 * sends the User to the consent page.
 */
export const agentGrantTenant = new AsyncLocalStorage<string>()

export function agentGrantProvider(options: AgentGrantOptions) {
  return oauthProvider({
    loginPage: options.consentUrl,
    consentPage: options.consentUrl,
    // Opaque tokens live in the database, so revoking a grant ends access on the next call.
    disableJwtPlugin: true,
    // No client_credentials: every token acts for a consenting User (no personal access tokens).
    grantTypes: ['authorization_code', 'refresh_token'],
    allowDynamicClientRegistration: true,
    allowUnauthenticatedClientRegistration: true,
    // Native MCP clients (Cursor, Claude Code) register loopback or custom-scheme
    // callbacks without application_type; web clients keep the https rule.
    clientRegistrationDefaultApplicationType: 'infer',
    resources: [options.resource],
    clientRegistrationDefaultResources: [options.resource],
    prefix: {
      opaqueAccessToken: AGENT_ACCESS_TOKEN_PREFIX,
      refreshToken: AGENT_REFRESH_TOKEN_PREFIX,
    },
    postLogin: {
      page: options.consentUrl,
      shouldRedirect: () => false,
      consentReferenceId: () => agentGrantTenant.getStore(),
    },
  })
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/** Tables the OAuth Provider owns; provider-table hardening revokes browser access to each. */
export const AGENT_GRANT_TABLES = [
  'oauthClient',
  'oauthResource',
  'oauthClientResource',
  'oauthRefreshToken',
  'oauthAccessToken',
  'oauthConsent',
  'oauthClientAssertion',
] as const

export interface AgentGrantTables {
  oauthClient: {
    clientId: string
    name: string | null
    uri: string | null
    icon: string | null
    disabled: boolean | null
  }
  oauthConsent: {
    id: string
    clientId: string
    userId: string
    referenceId: string
    scopes: unknown
    createdAt: Date
    updatedAt: Date
    lastUsedAt: Date | null
  }
  oauthAccessToken: {
    token: string
    clientId: string
    userId: string
    referenceId: string
    resources: unknown
    expiresAt: Date
    revoked: Date | null
  }
  oauthRefreshToken: { clientId: string; userId: string; referenceId: string }
}

type GrantDb = Kysely<BetterAuthDatabase & AgentGrantTables>

/**
 * Better Auth's generated OAuth Provider schema, plus the grant invariants:
 * consents and tokens always name a User and a tenant, a grant is unique per
 * User, client and tenant, and none of the three can change once written.
 */
export async function createAgentGrantTables(db: Kysely<BetterAuthDatabase>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS "oauthClient" (
      "id" text NOT NULL PRIMARY KEY, "clientId" text NOT NULL UNIQUE, "clientSecret" text,
      "clientDiscoveryId" text, "disabled" boolean, "skipConsent" boolean, "enableEndSession" boolean,
      "subjectType" text, "scopes" jsonb, "clientCredentialsScopes" jsonb,
      "userId" text REFERENCES "user" ("id") ON DELETE CASCADE, "createdAt" timestamptz,
      "updatedAt" timestamptz, "name" text, "uri" text, "icon" text, "contacts" jsonb, "tos" text,
      "policy" text, "softwareId" text, "softwareVersion" text, "softwareStatement" text,
      "redirectUris" jsonb NOT NULL, "postLogoutRedirectUris" jsonb, "backchannelLogoutUri" text,
      "backchannelLogoutSessionRequired" boolean, "tokenEndpointAuthMethod" text,
      "applicationType" text, "jwks" text, "jwksUri" text, "grantTypes" jsonb, "responseTypes" jsonb,
      "requirePKCE" boolean, "dpopBoundAccessTokens" boolean, "referenceId" text, "metadata" jsonb
    );
    CREATE TABLE IF NOT EXISTS "oauthResource" (
      "id" text NOT NULL PRIMARY KEY, "identifier" text NOT NULL UNIQUE, "name" text NOT NULL,
      "accessTokenTtl" integer, "refreshTokenTtl" integer, "signingAlgorithm" text,
      "signingKeyId" text, "allowedScopes" jsonb, "customClaims" jsonb,
      "dpopBoundAccessTokensRequired" boolean, "disabled" boolean, "createdAt" timestamptz,
      "updatedAt" timestamptz, "policyVersion" integer, "metadata" jsonb
    );
    CREATE TABLE IF NOT EXISTS "oauthClientResource" (
      "id" text NOT NULL PRIMARY KEY,
      "clientId" text NOT NULL REFERENCES "oauthClient" ("clientId") ON DELETE CASCADE,
      "resourceId" text NOT NULL REFERENCES "oauthResource" ("identifier") ON DELETE CASCADE,
      "metadata" jsonb, "createdAt" timestamptz
    );
    CREATE TABLE IF NOT EXISTS "oauthRefreshToken" (
      "id" text NOT NULL PRIMARY KEY, "token" text NOT NULL UNIQUE,
      "clientId" text NOT NULL REFERENCES "oauthClient" ("clientId") ON DELETE CASCADE,
      "sessionId" text REFERENCES "session" ("id") ON DELETE SET NULL,
      "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
      "referenceId" text NOT NULL, "authorizationCodeId" text, "resources" jsonb,
      "requestedUserInfoClaims" jsonb, "expiresAt" timestamptz NOT NULL,
      "createdAt" timestamptz NOT NULL, "revoked" timestamptz, "rotatedAt" timestamptz,
      "rotationReplayResponse" text, "rotationReplayExpiresAt" timestamptz, "authTime" timestamptz,
      "confirmation" jsonb, "scopes" jsonb NOT NULL
    );
    CREATE TABLE IF NOT EXISTS "oauthAccessToken" (
      "id" text NOT NULL PRIMARY KEY, "token" text NOT NULL UNIQUE,
      "clientId" text NOT NULL REFERENCES "oauthClient" ("clientId") ON DELETE CASCADE,
      "sessionId" text REFERENCES "session" ("id") ON DELETE SET NULL,
      "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
      "referenceId" text NOT NULL, "authorizationCodeId" text, "resources" jsonb,
      "requestedUserInfoClaims" jsonb,
      "refreshId" text REFERENCES "oauthRefreshToken" ("id") ON DELETE CASCADE,
      "expiresAt" timestamptz NOT NULL, "createdAt" timestamptz NOT NULL, "revoked" timestamptz,
      "confirmation" jsonb, "scopes" jsonb NOT NULL
    );
    CREATE TABLE IF NOT EXISTS "oauthConsent" (
      "id" text NOT NULL PRIMARY KEY,
      "clientId" text NOT NULL REFERENCES "oauthClient" ("clientId") ON DELETE CASCADE,
      "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
      "referenceId" text NOT NULL, "resources" jsonb, "requestedUserInfoClaims" jsonb,
      "scopes" jsonb NOT NULL, "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL,
      "lastUsedAt" timestamptz,
      UNIQUE ("clientId", "userId", "referenceId")
    );
    CREATE TABLE IF NOT EXISTS "oauthClientAssertion" (
      "id" text NOT NULL PRIMARY KEY, "expiresAt" timestamptz NOT NULL
    );
    CREATE INDEX IF NOT EXISTS "oauthClient_userId_idx" ON "oauthClient" ("userId");
    CREATE INDEX IF NOT EXISTS "oauthClientResource_resourceId_idx" ON "oauthClientResource" ("resourceId");
    CREATE UNIQUE INDEX IF NOT EXISTS "oauthClientResource_clientId_resourceId_uidx"
      ON "oauthClientResource" ("clientId", "resourceId");
    CREATE INDEX IF NOT EXISTS "oauthRefreshToken_grant_idx" ON "oauthRefreshToken" ("userId", "clientId", "referenceId");
    CREATE INDEX IF NOT EXISTS "oauthRefreshToken_sessionId_idx" ON "oauthRefreshToken" ("sessionId");
    CREATE INDEX IF NOT EXISTS "oauthRefreshToken_authorizationCodeId_idx" ON "oauthRefreshToken" ("authorizationCodeId");
    CREATE INDEX IF NOT EXISTS "oauthAccessToken_grant_idx" ON "oauthAccessToken" ("userId", "clientId", "referenceId");
    CREATE INDEX IF NOT EXISTS "oauthAccessToken_sessionId_idx" ON "oauthAccessToken" ("sessionId");
    CREATE INDEX IF NOT EXISTS "oauthAccessToken_authorizationCodeId_idx" ON "oauthAccessToken" ("authorizationCodeId");
    CREATE INDEX IF NOT EXISTS "oauthAccessToken_refreshId_idx" ON "oauthAccessToken" ("refreshId");
    CREATE INDEX IF NOT EXISTS "oauthConsent_userId_idx" ON "oauthConsent" ("userId");

    CREATE OR REPLACE FUNCTION public.agent_grant_binding_immutable()
    RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
    BEGIN
      IF NEW."userId" IS DISTINCT FROM OLD."userId"
        OR NEW."clientId" IS DISTINCT FROM OLD."clientId"
        OR NEW."referenceId" IS DISTINCT FROM OLD."referenceId" THEN
        RAISE EXCEPTION 'an agent grant''s user, client and tenant are fixed at consent'
          USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE OR REPLACE TRIGGER agent_grant_binding_immutable BEFORE UPDATE ON "oauthConsent"
      FOR EACH ROW EXECUTE FUNCTION public.agent_grant_binding_immutable();
    CREATE OR REPLACE TRIGGER agent_grant_binding_immutable BEFORE UPDATE ON "oauthAccessToken"
      FOR EACH ROW EXECUTE FUNCTION public.agent_grant_binding_immutable();
    CREATE OR REPLACE TRIGGER agent_grant_binding_immutable BEFORE UPDATE ON "oauthRefreshToken"
      FOR EACH ROW EXECUTE FUNCTION public.agent_grant_binding_immutable();
  `.execute(db)
}

// ---------------------------------------------------------------------------
// Token resolution
// ---------------------------------------------------------------------------

export interface AgentGrantToken {
  grantId: string
  userId: string
  tenantId: string
  clientId: string
}

/** Better Auth's default token hash: SHA-256, base64url without padding, of the unprefixed token. */
function storedTokenHash(token: string): string {
  return createHash('sha256')
    .update(token.slice(AGENT_ACCESS_TOKEN_PREFIX.length))
    .digest('base64url')
}

/**
 * Resolve an agent access token issued for `resource`. Expired, revoked,
 * unknown and other-audience tokens, tokens of a disabled client and tokens
 * whose grant was revoked all resolve to null.
 */
export async function lookupAgentGrantToken(
  db: Kysely<BetterAuthDatabase>,
  token: string,
  resource: string,
): Promise<AgentGrantToken | null> {
  if (!token.startsWith(AGENT_ACCESS_TOKEN_PREFIX)) return null
  const grants = db as unknown as GrantDb
  const row = await grants
    .selectFrom('oauthAccessToken as t')
    .innerJoin('oauthConsent as c', (join) =>
      join
        .onRef('c.clientId', '=', 't.clientId')
        .onRef('c.userId', '=', 't.userId')
        .onRef('c.referenceId', '=', 't.referenceId'),
    )
    .innerJoin('oauthClient as cl', 'cl.clientId', 't.clientId')
    .select([
      'c.id as grantId',
      't.userId as userId',
      't.referenceId as tenantId',
      't.clientId as clientId',
    ])
    .where('t.token', '=', storedTokenHash(token))
    .where('t.expiresAt', '>', new Date())
    .where('t.revoked', 'is', null)
    .where(sql<boolean>`coalesce(cl."disabled", false) = false`)
    .where(
      sql<boolean>`coalesce(t."resources", '[]'::jsonb) @> jsonb_build_array(${resource}::text)`,
    )
    .executeTakeFirst()
  if (!row) return null
  await grants
    .updateTable('oauthConsent')
    .set({ lastUsedAt: sql`now()` })
    .where('id', '=', row.grantId)
    .where((eb) =>
      eb.or([
        eb('lastUsedAt', 'is', null),
        eb('lastUsedAt', '<', sql<Date>`now() - ${LAST_USED_RESOLUTION}::interval`),
      ]),
    )
    .execute()
  return row
}

// ---------------------------------------------------------------------------
// Connected agents
// ---------------------------------------------------------------------------

export interface AgentGrant {
  id: string
  client_id: string
  client_name: string | null
  client_uri: string | null
  logo_uri: string | null
  tenant_id: string
  scopes: string[]
  created_at: string
  last_used_at: string | null
}

/** A registered, enabled client by id, for the consent screen; undefined when unknown. */
export function findEnabledAgentClient(db: Kysely<BetterAuthDatabase>, clientId: string) {
  return (db as unknown as GrantDb)
    .selectFrom('oauthClient')
    .select(['clientId', 'name', 'uri', 'icon'])
    .where('clientId', '=', clientId)
    .where(sql<boolean>`coalesce("disabled", false) = false`)
    .executeTakeFirst()
}

export async function listAgentGrants(
  db: Kysely<BetterAuthDatabase>,
  userId: string,
): Promise<AgentGrant[]> {
  const rows = await (db as unknown as GrantDb)
    .selectFrom('oauthConsent as c')
    .innerJoin('oauthClient as cl', 'cl.clientId', 'c.clientId')
    .select([
      'c.id',
      'c.clientId',
      'cl.name',
      'cl.uri',
      'cl.icon',
      'c.referenceId',
      'c.scopes',
      'c.createdAt',
      'c.lastUsedAt',
    ])
    .where('c.userId', '=', userId)
    .orderBy('c.createdAt', 'desc')
    .execute()
  return rows.map((row) => ({
    id: row.id,
    client_id: row.clientId,
    client_name: row.name,
    client_uri: row.uri,
    logo_uri: row.icon,
    tenant_id: row.referenceId,
    scopes: Array.isArray(row.scopes) ? row.scopes.filter((s) => typeof s === 'string') : [],
    created_at: row.createdAt.toISOString(),
    last_used_at: row.lastUsedAt?.toISOString() ?? null,
  }))
}

/**
 * Revoke one of the User's grants: its consent and every token issued under
 * it. Sessions and the User's other grants are untouched. Returns false when
 * the User holds no such grant.
 */
export async function revokeAgentGrant(
  db: Kysely<BetterAuthDatabase>,
  userId: string,
  grantId: string,
): Promise<boolean> {
  return (db as unknown as GrantDb).transaction().execute(async (trx) => {
    const grant = await trx
      .deleteFrom('oauthConsent')
      .where('id', '=', grantId)
      .where('userId', '=', userId)
      .returning(['clientId', 'referenceId'])
      .executeTakeFirst()
    if (!grant) return false
    for (const table of ['oauthAccessToken', 'oauthRefreshToken'] as const) {
      await trx
        .deleteFrom(table)
        .where('userId', '=', userId)
        .where('clientId', '=', grant.clientId)
        .where('referenceId', '=', grant.referenceId)
        .execute()
    }
    return true
  })
}
