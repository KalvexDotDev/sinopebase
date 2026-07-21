// ---------------------------------------------------------------------------
// better-auth factory for Sinopebase
//
// Creates and configures a better-auth instance backed by a Kysely / PG pool,
// and exports convenience wrappers for the most common server-side auth
// operations (sign-up, sign-in, session lookup, sign-out).
// ---------------------------------------------------------------------------

import { betterAuth } from 'better-auth'
import { genericOAuth } from 'better-auth/plugins/generic-oauth'
import pg from 'pg'
import { Kysely } from 'kysely'

// Guard against redundant DDL on hot reload or multiple createAuth calls
let tablesEnsured = false

import {
  createBetterAuthDB,
  createAuthTables,
  type BetterAuthDatabase,
} from './adapter'

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
  if (!tablesEnsured) {
    await createAuthTables(db)
    tablesEnsured = true
  }

  const secret =
    options?.jwtSecret ||
    process.env.JWT_SECRET ||
    'sinopebase-dev-secret-min-32-chars!!'

  const trustedOrigins = [
    'http://localhost:8090',
    'http://127.0.0.1:8090',
    ...(options?.extraOrigins || []),
  ]

  // Build plugins array
  const plugins: any[] = []
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
    emailAndPassword: { enabled: true },
    secret,
    trustedOrigins,
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
  ;(auth as any).__db = db

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
export async function lookupSessionByToken(
  auth: SinopebaseAuth,
  token: string | null,
): Promise<SessionLookup | null> {
  if (!token) return null
  try {
    const db = (auth as any).__db as import('kysely').Kysely<import('./adapter').BetterAuthDatabase> | undefined
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
