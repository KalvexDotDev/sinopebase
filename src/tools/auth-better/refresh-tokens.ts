// ---------------------------------------------------------------------------
// GoTrue-compatible refresh tokens and logout for better-auth sessions
//
// The access token handed to clients is the better-auth session token. The
// refresh token is a separate opaque value stored in `refresh_tokens`, so the
// family / replay machinery sees the value the client actually presents.
//
// Reuse rules follow GoTrue (supabase/auth internal/tokens/service.go):
//   - a consumed token that is the parent of the session's active token, or
//     that was consumed less than REFRESH_TOKEN_REUSE_INTERVAL_MS ago, returns
//     the session's current pair (concurrent tabs / SSR requests / a client
//     that lost the refresh response);
//   - any other reuse revokes the token family and ends the session.
// Unlike GoTrue, an allowed reuse never forks a new token: rotating the
// session token again would invalidate the access token the winner returned.
// ---------------------------------------------------------------------------

import type { Kysely } from 'kysely'
import type { BetterAuthDatabase } from './adapter'

type AuthDb = Kysely<BetterAuthDatabase>
type RefreshTokenRow = BetterAuthDatabase['refresh_tokens']

/** GoTrue's default GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL (10 seconds). */
export const REFRESH_TOKEN_REUSE_INTERVAL_MS = 10_000
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface SessionPair {
  accessToken: string
  refreshToken: string
}

export const LOGOUT_SCOPES = ['global', 'local', 'others'] as const
export type LogoutScope = (typeof LOGOUT_SCOPES)[number]

function opaqueToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
}

function liveSession(db: AuthDb, column: 'token' | 'id', value: string) {
  return db
    .selectFrom('session')
    .select(['id', 'userId', 'token'])
    .where(column, '=', value)
    .where('expiresAt', '>', new Date())
    .executeTakeFirst()
}

function activeToken(db: AuthDb, sessionId: string) {
  return db
    .selectFrom('refresh_tokens')
    .select(['token_id', 'parent_token_id'])
    .where('session_id', '=', sessionId)
    .where('consumed', '=', false)
    .where('compromised', '=', false)
    .where('expires_at', '>', new Date())
    .orderBy('created_at', 'desc')
    .executeTakeFirst()
}

async function insertToken(
  db: AuthDb,
  owner: Pick<RefreshTokenRow, 'user_id' | 'session_id' | 'family_id' | 'parent_token_id'>,
): Promise<string> {
  const tokenId = opaqueToken()
  await db
    .insertInto('refresh_tokens')
    .values({
      ...owner,
      token_id: tokenId,
      consumed: false,
      compromised: false,
      expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      created_at: new Date(),
    })
    .execute()
  return tokenId
}

/**
 * The refresh token for a live session: its active token, or the first token
 * of a new family. Throws when the session token is unknown or expired.
 */
export async function refreshTokenForSession(db: AuthDb, sessionToken: string): Promise<string> {
  const session = await liveSession(db, 'token', sessionToken)
  if (!session) throw new Error('Authentication failed')
  const active = await activeToken(db, session.id)
  return (
    active?.token_id ??
    insertToken(db, {
      user_id: session.userId,
      session_id: session.id,
      family_id: crypto.randomUUID(),
      parent_token_id: null,
    })
  )
}

/** Consume `row` and rotate the session. 'reused' when another request consumed it first. */
function rotate(db: AuthDb, row: RefreshTokenRow): Promise<SessionPair | 'reused' | null> {
  return db.transaction().execute(async (trx) => {
    // The row lock serialises concurrent refreshes: the loser waits for this
    // transaction and then sees consumed = true, so it takes the reuse path.
    const claimed = await trx
      .updateTable('refresh_tokens')
      .set({ consumed: true })
      .where('token_id', '=', row.token_id)
      .where('consumed', '=', false)
      .executeTakeFirst()
    if (claimed.numUpdatedRows === 0n) return 'reused'
    const accessToken = opaqueToken()
    const rotated = await trx
      .updateTable('session')
      .set({ token: accessToken, updatedAt: new Date() })
      .where('id', '=', row.session_id)
      .where('expiresAt', '>', new Date())
      .executeTakeFirst()
    if (rotated.numUpdatedRows === 0n) return null
    const refreshToken = await insertToken(trx, { ...row, parent_token_id: row.token_id })
    return { accessToken, refreshToken }
  })
}

async function reuseAllowed(db: AuthDb, row: RefreshTokenRow, activeParent: string | null) {
  if (activeParent === row.token_id) return true
  // A consumed token whose session is live always has a child (rotate inserts it).
  const child = await db
    .selectFrom('refresh_tokens')
    .select('created_at')
    .where('parent_token_id', '=', row.token_id)
    .executeTakeFirstOrThrow()
  return Date.now() - child.created_at.getTime() < REFRESH_TOKEN_REUSE_INTERVAL_MS
}

async function reuse(db: AuthDb, row: RefreshTokenRow): Promise<SessionPair | null> {
  const [active, session] = await Promise.all([
    activeToken(db, row.session_id),
    liveSession(db, 'id', row.session_id),
  ])
  if (active && session && (await reuseAllowed(db, row, active.parent_token_id))) {
    return { accessToken: session.token, refreshToken: active.token_id }
  }
  await db
    .updateTable('refresh_tokens')
    .set({ compromised: true })
    .where('family_id', '=', row.family_id)
    .execute()
  await db.deleteFrom('session').where('id', '=', row.session_id).execute()
  console.error(
    `[AUDIT] Refresh token reuse detected: family=${row.family_id}, user=${row.user_id}; session ended`,
  )
  return null
}

/**
 * Exchange a refresh token for a session pair (grant_type=refresh_token).
 * Returns null when the token is invalid, expired, revoked or replayed.
 */
export async function exchangeRefreshToken(
  db: AuthDb,
  presented: string,
): Promise<SessionPair | null> {
  const row = await db
    .selectFrom('refresh_tokens')
    .selectAll()
    .where('token_id', '=', presented)
    .executeTakeFirst()
  // ponytail: clients signed in before #35 hold the session token as their refresh
  // token. Remove this fallback once those sessions expire (7 days after deploy), #36.
  if (!row) return exchangeLegacySessionToken(db, presented)
  if (row.compromised || row.expires_at <= new Date()) return null
  const rotated = await rotate(db, row)
  return rotated === 'reused' ? reuse(db, row) : rotated
}

async function exchangeLegacySessionToken(
  db: AuthDb,
  sessionToken: string,
): Promise<SessionPair | null> {
  const session = await liveSession(db, 'token', sessionToken)
  if (!session) return null
  return { accessToken: sessionToken, refreshToken: await refreshTokenForSession(db, sessionToken) }
}

/**
 * Revoke sessions for POST /auth/v1/logout (GoTrue scopes). Deletes the
 * session rows, which invalidates their access tokens, and their refresh
 * tokens. Returns false when the access token is not a live session.
 */
export async function revokeSessions(
  db: AuthDb,
  accessToken: string,
  scope: LogoutScope,
): Promise<boolean> {
  const session = await liveSession(db, 'token', accessToken)
  if (!session) return false
  await db.transaction().execute(async (trx) => {
    let sessions = trx.deleteFrom('session').where('userId', '=', session.userId)
    if (scope === 'local') sessions = sessions.where('id', '=', session.id)
    if (scope === 'others') sessions = sessions.where('id', '<>', session.id)
    const revoked = await sessions.returning('id').execute()
    if (revoked.length === 0) return
    await trx
      .deleteFrom('refresh_tokens')
      .where(
        'session_id',
        'in',
        revoked.map((r) => r.id),
      )
      .execute()
  })
  return true
}
