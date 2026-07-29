// ---------------------------------------------------------------------------
// better-auth factory for Sinopebase
//
// Creates and configures a better-auth instance backed by a Kysely / PG pool,
// and exports convenience wrappers for the most common server-side auth
// operations (sign-up, sign-in, session lookup, sign-out).
// ---------------------------------------------------------------------------

import { betterAuth } from 'better-auth'
import { genericOAuth } from 'better-auth/plugins/generic-oauth'
import { type Kysely, sql } from 'kysely'
import type pg from 'pg'
import { JWT_DEV_FALLBACK } from '~/tools/security/constants'
import type { BetterAuthDatabase } from './adapter'

// Guard against redundant DDL on hot reload or multiple createAuth calls
let tablesEnsured = false

import { createAuthTables, createBetterAuthDB } from './adapter'

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

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**

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
  if (!tablesEnsured) {
    await createAuthTables(db)
    await createRefreshTokensTable(db)
    tablesEnsured = true
  }

  const secret = options?.jwtSecret || process.env.JWT_SECRET || JWT_DEV_FALLBACK

  const trustedOrigins = [
    'http://localhost:8090',
    'http://127.0.0.1:8090',
    ...(options?.extraOrigins?.filter((o) => o && o !== '*') || []),
  ]

  // Build plugins array
  const plugins: Record<string, unknown>[] = []
  if (options?.oauthProviders?.length) {
    plugins.push(
      genericOAuth({
        config: options.oauthProviders.map((p) => ({
          providerId: p.providerId,
          clientId: p.clientId,
          clientSecret: p.clientSecret,
          tenantId: p.tenantId,
          issuer: p.issuer,
        })),
      }),
    )
  }

  // Pass the pg.Pool directly — better-auth's createKyselyAdapter detects
  // pools via the `.connect()` method and auto-creates PostgresDialect.
  const auth = betterAuth({
    database: pool,
    basePath: '/api/auth', // Explicit base path
    advanced: {
      database: {
        generateId: () => crypto.randomUUID(),
      },
    },
    emailAndPassword: { enabled: true },
    secret,
    trustedOrigins,
    baseURL: process.env.BETTER_AUTH_URL || process.env.SINOPEBASE_URL || 'http://localhost:8090',
    plugins,
    // Social login links accounts by email by default
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: options?.oauthProviders?.map((p) => p.providerId) || [],
      },
    },
  })

  // Attach the typed Kysely so callers can do direct lookups (better-auth's
  // getSession is cookie-based; direct DB queries are needed for Bearer tokens).
  ;(auth as Record<string, unknown>).__db = db

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
  name: string | null
  image: string | null
  role: string
  createdAt: Date
  updatedAt: Date
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
        'user.name',
        'user.image',
        'user.role',
        'user.createdAt',
        'user.updatedAt',
      ])
      .where('session.token', '=', token)
      .where('session.expiresAt', '>', new Date())
      .execute()
    return rows[0] ?? null
  } catch {
    return null
  }
}
