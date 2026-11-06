// ---------------------------------------------------------------------------
// better-auth factory for Sinopebase
//
// Creates and configures a better-auth instance backed by a Kysely / PG pool,
// and exports convenience wrappers for the most common server-side auth
// operations (sign-up, sign-in, session lookup, sign-out).
// ---------------------------------------------------------------------------

import type { BetterAuthPlugin } from 'better-auth'
import { getOAuthState } from 'better-auth/api'
import { type GenericOAuthConfig, genericOAuth } from 'better-auth/plugins/generic-oauth'
import { type Kysely, sql } from 'kysely'
import type pg from 'pg'
import { JWT_DEV_FALLBACK } from '~/tools/security/constants'
import type { BetterAuthDatabase } from './adapter'
import { createAuthTables, createBetterAuthDB } from './adapter'
import {
  AGENT_GRANT_TABLES,
  type AgentGrantOptions,
  type AgentGrantToken,
  agentGrantProvider,
  createAgentGrantTables,
  lookupAgentGrantToken,
} from './agent-grants'
import {
  decideIdentityLink,
  microsoftAccountId,
  type ProviderIdentity,
} from './identity-linking-policy'
import { bindRecoveryLink, dropRecoveryLink } from './recovery-links'
import { createAuthWithSignupPolicy as betterAuth, signupsAllowed } from './signup-policy'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Built-in social providers supported directly by better-auth v1.6.25. */
export const BUILTIN_SOCIAL = new Set([
  'google',
  'github',
  'discord',
  'apple',
  'microsoft',
  'spotify',
  'twitch',
  'twitter',
  'dropbox',
  'linkedin',
  'gitlab',
  'bitbucket',
])

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OAuthProviderConfig {
  providerId: string
  clientId: string
  clientSecret: string
  /** Required for Entra ID / OIDC providers */
  tenantId?: string
  /** Required for Keycloak / OIDC providers */
  issuer?: string
}

export interface CreateAuthOptions {
  jwtSecret?: string
  /** OAuth/OIDC providers for social login + enterprise SSO */
  oauthProviders?: OAuthProviderConfig[]
  /** Additional trusted origins (e.g. production domain) */
  extraOrigins?: string[]
  /** Deliver transactional email (password recovery, verification). */
  sendEmail?: (mail: { to: string; subject: string; text: string; html?: string }) => Promise<void>
  /** Recovery links fall back here when redirect_to is absent or untrusted (GoTrue SITE_URL). */
  siteUrl?: string
  /** Disable Better Auth diagnostics only for a private maintenance command handling credentials. */
  disableLogsForMaintenance?: true
  /** Issue OAuth agent grants for this resource (sinope#1098); absent, no OAuth provider runs. */
  agentGrants?: AgentGrantOptions
}

interface SocialProviderConfig {
  clientId: string
  clientSecret: string
  disableSignUp: boolean
  tenantId?: string
  disableProfilePhoto?: boolean
  mapProfileToUser?: () => { emailVerified: false }
}

/** Better Auth uses these provider flags at OAuth callback time, including explicit requestSignUp. */
export function buildOAuthProviderConfigs(allProviders: OAuthProviderConfig[]) {
  const disableSignUp = !signupsAllowed()
  const socialProviders: Record<string, SocialProviderConfig> = {}
  // tenantId is carried for operator configuration; Better Auth's generic config ignores it.
  const genericConfigs: Array<GenericOAuthConfig & { tenantId?: string }> = []

  for (const p of allProviders) {
    if (p.providerId === 'microsoft') {
      socialProviders.microsoft = {
        clientId: p.clientId,
        clientSecret: p.clientSecret,
        disableSignUp,
        // 'organizations' (work and school accounts) unless the operator names one tenant.
        tenantId: p.tenantId || 'organizations',
        // No Graph photo fetch: the profile comes from the ID token alone.
        disableProfilePhoto: true,
        // The email claim is never authoritative (nOAuth); see ./identity-linking-policy.
        mapProfileToUser: () => ({ emailVerified: false }),
      }
    } else if (BUILTIN_SOCIAL.has(p.providerId)) {
      socialProviders[p.providerId] = {
        clientId: p.clientId,
        clientSecret: p.clientSecret,
        disableSignUp,
      }
    } else {
      const config: GenericOAuthConfig & { tenantId?: string } = {
        providerId: p.providerId,
        clientId: p.clientId,
        clientSecret: p.clientSecret,
        disableSignUp,
      }
      if (p.issuer) {
        const issuer = p.issuer.replace(/\/$/, '')
        config.discoveryUrl = `${issuer}/.well-known/openid-configuration`
      }
      if (p.tenantId) config.tenantId = p.tenantId
      genericConfigs.push(config)
    }
  }

  return { socialProviders, genericConfigs }
}

/** Key Microsoft accounts on tid + oid; Better Auth's built-in provider keys on oid alone. */
const microsoftTenantObjectKey: BetterAuthPlugin = {
  id: 'sinopebase-microsoft-account-key',
  init: (context) => ({
    context: {
      socialProviders: context.socialProviders.map((provider) =>
        provider.id === 'microsoft'
          ? {
              ...provider,
              accountSubject: ({ profile }: { profile: object }) =>
                microsoftAccountId(profile as Record<string, unknown>),
            }
          : provider,
      ),
    },
  }),
}

type ValidateUserInfo = NonNullable<
  NonNullable<Parameters<typeof betterAuth>[0]['user']>['validateUserInfo']
>

/**
 * Enforce the Identity Linking Policy wherever Better Auth links an OAuth
 * identity to an existing user. An explicit link (Account page) carries the
 * signed-in user in its server-side OAuth state; any other link is implicit,
 * matched on email. Better Auth has already resolved identity ownership.
 */
export const enforceIdentityLinkingPolicy: ValidateUserInfo = async ({ user, source }, context) => {
  if (source.method !== 'oauth' || source.action !== 'link-account') return
  const identity = {
    providerId: source.oauth?.providerId ?? '',
    emailVerified: user.emailVerified === true,
  }
  const decision = await linkDecision(identity, String(user.id), context)
  if (decision.action === 'refuse')
    return { error: decision.reason, errorDescription: 'This sign-in method cannot be linked.' }
}

async function linkDecision(
  identity: ProviderIdentity,
  userId: string,
  context: Parameters<ValidateUserInfo>[1],
) {
  const existing = { kind: 'email_match' as const, userId }
  if ((await getOAuthState())?.link?.userId === userId)
    return decideIdentityLink(identity, { ...existing, emailVerified: true }, userId)
  const local = await context.context.internalAdapter.findUserById(userId)
  return decideIdentityLink(identity, { ...existing, emailVerified: local?.emailVerified === true })
}

function oauthOptions(allProviders: OAuthProviderConfig[], agentGrants?: AgentGrantOptions) {
  const { socialProviders, genericConfigs } = buildOAuthProviderConfigs(allProviders)
  const plugins: BetterAuthPlugin[] = []
  if (genericConfigs.length > 0) plugins.push(genericOAuth({ config: genericConfigs }))
  if (socialProviders.microsoft) plugins.push(microsoftTenantObjectKey)
  if (agentGrants) plugins.push(agentGrantProvider(agentGrants))
  return {
    socialProviders: Object.keys(socialProviders).length > 0 ? socialProviders : undefined,
    plugins,
    account: {
      // Trusting every provider by name only lifts Better Auth's own emailVerified gate;
      // enforceIdentityLinkingPolicy decides every link instead. Explicit links may
      // differ in email: the signed-in user proves both identities.
      accountLinking: {
        enabled: true,
        trustedProviders: allProviders.map((p) => p.providerId),
        allowDifferentEmails: true,
      },
    },
  }
}

/**
 * GoTrue recovery link: the requested destination (Better Auth's callbackURL,
 * already allow-listed by POST /auth/v1/recover) or the site URL, carrying the
 * single-use token as `token_hash` and `type=recovery` for verifyOtp.
 */
export function recoveryLink(betterAuthUrl: string, token: string, siteUrl: string): string {
  const link = new URL(new URL(betterAuthUrl).searchParams.get('callbackURL') || siteUrl)
  link.searchParams.set('token_hash', token)
  link.searchParams.set('type', 'recovery')
  return link.href
}

/** Delivers a GoTrue email-change link to the new address; see `./email-change`. */
export type EmailChangeMailer = (
  to: string,
  token: string,
  redirectTo: string | undefined,
) => Promise<void>

/**
 * GoTrue email-change link: the allow-listed redirect_to or the site URL, carrying
 * the single-use token as `token_hash` and `type=email_change` for verifyOtp.
 */
export function emailChangeLink(redirectTo: string | undefined, token: string, siteUrl: string) {
  const link = new URL(redirectTo || siteUrl)
  link.searchParams.set('token_hash', token)
  link.searchParams.set('type', 'email_change')
  return link.href
}

function emailChangeMailer(
  sendEmail: CreateAuthOptions['sendEmail'],
  siteUrl: string,
): EmailChangeMailer | undefined {
  if (!sendEmail) return undefined
  return async (to, token, redirectTo) => {
    const link = emailChangeLink(redirectTo, token, siteUrl)
    await sendEmail({
      to,
      subject: 'Confirm your new email address',
      text: `Confirm your new email address: ${link}`,
      html: `<p>Confirm your new email address: <a href="${link.replaceAll('&', '&amp;')}">Confirm email address</a></p>`,
    })
  }
}

function mailerOptions(
  db: Kysely<BetterAuthDatabase>,
  sendEmail: CreateAuthOptions['sendEmail'],
  siteUrl: string,
) {
  if (!sendEmail) return { emailAndPassword: { enabled: true } }
  return {
    emailAndPassword: {
      enabled: true,
      sendResetPassword: async ({
        user,
        url,
        token,
      }: {
        user: { email: string }
        url: string
        token: string
      }) => {
        const link = recoveryLink(url, token, siteUrl)
        await bindRecoveryLink(db, token, user.email)
        try {
          await sendEmail({
            to: user.email,
            subject: 'Reset your password',
            text: `Reset your password: ${link}`,
            html: `<p>Reset your password: <a href="${link.replaceAll('&', '&amp;')}">Reset password</a></p>`,
          })
        } catch (error) {
          // An undelivered link must not stay valid; POST /auth/v1/recover then reopens its window.
          await dropRecoveryLink(db, token)
          throw error
        }
      },
    },
    emailVerification: {
      enabled: true,
      sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) => {
        await sendEmail({
          to: user.email,
          subject: 'Verify your email',
          text: `Verify your email: ${url}`,
        })
      },
    },
  }
}

function trustedOrigins(extraOrigins?: string[]) {
  return [
    'http://localhost:8090',
    'http://127.0.0.1:8090',
    ...(extraOrigins?.filter((origin) => origin && origin !== '*') || []),
  ]
}

function maintenanceLogger(disabled?: true) {
  return disabled ? { disabled: true } : undefined
}

function authOptions(
  pool: pg.Pool,
  db: Kysely<BetterAuthDatabase>,
  baseURL: string,
  options?: CreateAuthOptions,
): Parameters<typeof betterAuth>[0] {
  const allProviders = options?.oauthProviders ?? []
  return {
    database: pool,
    logger: maintenanceLogger(options?.disableLogsForMaintenance),
    basePath: '/api/auth',
    // Recovery runs only through GoTrue's /auth/v1/recover and /auth/v1/verify. Email
    // changes likewise run only through PUT /auth/v1/user and /auth/v1/verify (see
    // ./email-change): Better Auth's own user.changeEmail stays disabled (its default).
    disabledPaths: ['/request-password-reset', '/reset-password'],
    user: {
      additionalFields: {
        emailVerifiedAt: { type: 'date', required: false, input: false },
        userMetadata: { type: 'json', required: false, input: false },
      },
      validateUserInfo: enforceIdentityLinkingPolicy,
    },
    // GoTrue amr method of a session ('recovery'); null for ordinary sign-ins.
    session: {
      additionalFields: { authMethod: { type: 'string', required: false, input: false } },
    },
    advanced: { database: { generateId: () => crypto.randomUUID() } },
    ...mailerOptions(db, options?.sendEmail, options?.siteUrl || baseURL),
    secret: options?.jwtSecret || process.env.JWT_SECRET || JWT_DEV_FALLBACK,
    trustedOrigins: trustedOrigins(options?.extraOrigins),
    baseURL,
    ...oauthOptions(allProviders, options?.agentGrants),
  }
}

// ---------------------------------------------------------------------------
// Refresh tokens table
// ---------------------------------------------------------------------------

/**
 * Create the `refresh_tokens` table if it does not already exist.
 *
 * This table stores refresh tokens with family tracking for rotation
 * and replay detection. Safe to call on every startup — uses IF NOT EXISTS.
 */
export async function createRefreshTokensTable(db: Kysely<BetterAuthDatabase>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS "refresh_tokens" (
      "token_id"        TEXT        PRIMARY KEY,
      "user_id"         TEXT        NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      "session_id"      TEXT        NOT NULL,
      "family_id"       TEXT        NOT NULL,
      "parent_token_id" TEXT,
      "consumed"        BOOLEAN    NOT NULL DEFAULT FALSE,
      "compromised"     BOOLEAN    NOT NULL DEFAULT FALSE,
      "expires_at"      TIMESTAMPTZ NOT NULL,
      "created_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family_id   ON "refresh_tokens"("family_id");
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id     ON "refresh_tokens"("user_id");
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_session_id  ON "refresh_tokens"("session_id");
  `.execute(db)
}

// ---------------------------------------------------------------------------
// Refresh token helpers — used by the better-auth bridge for rotation + replay
// ---------------------------------------------------------------------------

/** Result of a refresh token rotation validation. */
export type RefreshTokenValidationResult =
  | { valid: true; token: BetterAuthDatabase['refresh_tokens'] }
  | { valid: false; replay?: boolean; compromised?: boolean }

/**
 * Find a refresh token record by its token_id.
 * Returns undefined if not found.
 */
export async function findRefreshToken(
  db: Kysely<BetterAuthDatabase>,
  tokenId: string,
): Promise<BetterAuthDatabase['refresh_tokens'] | undefined> {
  const rows = await db
    .selectFrom('refresh_tokens')
    .selectAll()
    .where('token_id', '=', tokenId)
    .execute()
  return rows[0]
}

/**
 * Store a new refresh token record in the database.
 */
export async function storeRefreshToken(
  db: Kysely<BetterAuthDatabase>,
  token: BetterAuthDatabase['refresh_tokens'],
): Promise<void> {
  await db.insertInto('refresh_tokens').values(token).execute()
}

/**
 * Mark a refresh token as consumed (after successful rotation).
 */
export async function consumeRefreshTokenDb(
  db: Kysely<BetterAuthDatabase>,
  tokenId: string,
): Promise<void> {
  await db
    .updateTable('refresh_tokens')
    .set({ consumed: true })
    .where('token_id', '=', tokenId)
    .execute()
}

/**
 * Mark an entire refresh token family as compromised (replay detected).
 */
export async function compromiseFamily(
  db: Kysely<BetterAuthDatabase>,
  familyId: string,
): Promise<void> {
  await db
    .updateTable('refresh_tokens')
    .set({ compromised: true })
    .where('family_id', '=', familyId)
    .execute()
}

/**
 * Validate a refresh token for rotation with replay detection.
 *
 * Returns:
 * - { valid: true, token } if the token is usable
 * - { valid: false, replay: true, compromised: true } if already consumed (replay)
 * - { valid: false, compromised: true } if the family is compromised
 * - { valid: false } if not found or expired
 *
 * On replay detection the entire family is marked compromised.
 */
export async function validateRefreshTokenForRotation(
  db: Kysely<BetterAuthDatabase>,
  tokenId: string,
): Promise<RefreshTokenValidationResult> {
  const token = await findRefreshToken(db, tokenId)
  if (!token) {
    return { valid: false }
  }

  // Check expiry
  if (token.expires_at < new Date()) {
    return { valid: false }
  }

  // Family already compromised — reject
  if (token.compromised) {
    return { valid: false, compromised: true }
  }

  // Token already consumed — REPLAY ATTACK
  if (token.consumed) {
    // Mark entire family as compromised
    await compromiseFamily(db, token.family_id)
    return { valid: false, replay: true, compromised: true }
  }

  return { valid: true, token }
}

/** Provider identities and credentials are internal, never browser-accessible tables. */
async function restrictProviderTableAccess(db: Kysely<BetterAuthDatabase>): Promise<void> {
  await sql`
    DO $$
    DECLARE
      provider_table text;
      column_names text;
      browser_role text;
    BEGIN
      FOREACH provider_table IN ARRAY ARRAY['user', 'session', 'account', 'verification', 'refresh_tokens', ${sql.raw(AGENT_GRANT_TABLES.map((table) => `'${table}'`).join(', '))}] LOOP
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', provider_table);
        SELECT string_agg(quote_ident(attname), ', ') INTO column_names
          FROM pg_attribute
          WHERE attrelid = format('public.%I', provider_table)::regclass
            AND attnum > 0 AND NOT attisdropped;
        EXECUTE format('REVOKE ALL (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated', column_names, provider_table);
        FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
          IF has_table_privilege(browser_role, format('public.%I', provider_table), 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
            OR has_any_column_privilege(browser_role, format('public.%I', provider_table), 'SELECT, INSERT, UPDATE, REFERENCES') THEN
            RAISE EXCEPTION 'Provider table browser privileges remain after hardening';
          END IF;
        END LOOP;
      END LOOP;
    END $$;
  `.execute(db)
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create and configure a better-auth instance.
 *
 * Supports email/password + optional OAuth/OIDC providers:
 *   Google, GitHub, Microsoft Entra ID, Keycloak, Okta, Auth0, Slack, etc.
 *
 * Enterprise SSO via Keycloak as SAML broker:
 *   Azure AD SAML → Keycloak → OIDC → Sinopebase (better-auth)
 *
 * @param pool    - A live `pg.Pool` connected to the backing database.
 * @param options - Optional overrides (jwtSecret, oauthProviders, extraOrigins).
 */
export async function createAuth(
  pool: pg.Pool,
  options?: CreateAuthOptions,
): Promise<ReturnType<typeof betterAuth>> {
  // Create a typed Kysely for table creation and direct queries.
  const db = createBetterAuthDB(pool)
  await db.transaction().execute(async (transaction) => {
    // Replicas starting together would deadlock on this DDL and these grants; take turns.
    // Same lock space as the migration lock (732031, 1), separate key.
    await sql`SELECT pg_advisory_xact_lock(732031, 2)`.execute(transaction)
    await createAuthTables(transaction)
    await createRefreshTokensTable(transaction)
    await createAgentGrantTables(transaction)
    await restrictProviderTableAccess(transaction)
  })

  // Pass the pg.Pool directly — better-auth's createKyselyAdapter detects
  // pools via the `.connect()` method and auto-creates PostgresDialect.
  const baseURL =
    process.env.BETTER_AUTH_URL || process.env.SINOPEBASE_URL || 'http://localhost:8090'
  const auth = betterAuth(authOptions(pool, db, baseURL, options))

  // Attach the typed Kysely so callers can do direct lookups (better-auth's
  // getSession is cookie-based; direct DB queries are needed for Bearer tokens).
  ;(auth as Record<string, unknown>).__db = db
  // The resource agent access tokens must be issued for (see lookupAgentGrantToken).
  ;(auth as Record<string, unknown>).__agentGrantResource = options?.agentGrants?.resource
  // GoTrue email change (PUT /auth/v1/user) mails through the same sender; absent without SMTP.
  ;(auth as Record<string, unknown>).__mailEmailChange = emailChangeMailer(
    options?.sendEmail,
    options?.siteUrl || baseURL,
  )
  // OAuth redirect_to falls back here when absent or untrusted, as recovery links do.
  ;(auth as Record<string, unknown>).__siteUrl = options?.siteUrl || baseURL

  return auth
}

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/** The concrete auth instance type returned by `createAuth`. */
export type SinopebaseAuth = Awaited<ReturnType<typeof createAuth>>

// ---------------------------------------------------------------------------
// Shared DB session lookup — used by auth middleware, DropFunctions, Mastra
// ---------------------------------------------------------------------------

/** Result of a session token lookup. */
export interface SessionLookup {
  id: string
  email: string
  emailVerified: boolean
  emailVerifiedAt: Date | null
  userMetadata: Record<string, unknown>
  name: string | null
  image: string | null
  role: string
  createdAt: Date
  updatedAt: Date
  /** When the session signed in (its creation); a refresh never moves it. */
  authenticatedAt: Date
}

/**
 * Look up a session by Bearer token via direct DB query.
 *
 * better-auth's getSession is cookie-based, so Bearer token validation
 * requires a direct Kysely query. This shared helper replaces 5
 * duplicated implementations across the codebase.
 *
 * Returns the joined user row, or null if the token is invalid or expired.
 */
/** Minimal auth shape needed by lookupSessionByToken — composes with any auth-like object. */
interface AuthWithDb {
  __db?: unknown
}

export async function lookupSessionByToken(
  auth: AuthWithDb,
  token: string | null,
): Promise<SessionLookup | null> {
  if (!token) return null
  try {
    const db = (auth as Record<string, unknown>).__db as
      | import('kysely').Kysely<import('./adapter').BetterAuthDatabase>
      | undefined
    if (!db) return null
    const rows = await db
      .selectFrom('session')
      .innerJoin('user', 'session.userId', 'user.id')
      .select([
        'user.id',
        'user.email',
        'user.emailVerified',
        'user.emailVerifiedAt',
        'user.userMetadata',
        'user.name',
        'user.image',
        'user.role',
        'user.createdAt',
        'user.updatedAt',
        'session.createdAt as authenticatedAt',
      ])
      .where('session.token', '=', token)
      .where('session.expiresAt', '>', new Date())
      .execute()
    return rows[0] ?? null
  } catch {
    return null
  }
}

/**
 * Resolve a Bearer token to the agent grant it was issued under, or null when
 * it is not a live agent access token for this server's agent resource.
 * Agent tokens are never sessions: callers that need a first-party User use
 * lookupSessionByToken, which does not accept them.
 */
export async function lookupAgentGrant(
  auth: AuthWithDb,
  token: string,
): Promise<AgentGrantToken | null> {
  const { __db: db, __agentGrantResource: resource } = auth as {
    __db?: Kysely<BetterAuthDatabase>
    __agentGrantResource?: string
  }
  if (!db || !resource) return null
  return lookupAgentGrantToken(db, token, resource)
}
