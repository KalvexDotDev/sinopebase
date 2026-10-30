// ---------------------------------------------------------------------------
// GoTrue recovery links on Better Auth's verification table
//
// Better Auth stores a reset token as `reset-password:<token>` with the user ID
// as its value. GoTrue binds a recovery token to the address it was mailed to,
// so each live token has a companion `recovery-email:<token>` row holding that
// address. Verification succeeds only while the account still has it.
// ---------------------------------------------------------------------------

import type { Kysely } from 'kysely'
import type { BetterAuthDatabase } from './adapter'

/** Better Auth's identifier prefix for single-use password reset tokens. */
export const RESET_PREFIX = 'reset-password:'
/** Companion row: the lower-cased address a recovery token was mailed to. */
export const RECOVERY_EMAIL_PREFIX = 'recovery-email:'
/** Better Auth's default resetPasswordTokenExpiresIn (one hour). */
const RECOVERY_LINK_TTL_MS = 60 * 60 * 1000

type AuthDb = Kysely<BetterAuthDatabase>

/** Record the address a recovery token is about to be mailed to. */
export async function bindRecoveryLink(db: AuthDb, token: string, email: string): Promise<void> {
  const now = new Date()
  await db
    .insertInto('verification')
    .values({
      id: crypto.randomUUID(),
      identifier: RECOVERY_EMAIL_PREFIX + token,
      value: email.toLowerCase(),
      expiresAt: new Date(now.getTime() + RECOVERY_LINK_TTL_MS),
      createdAt: now,
      updatedAt: now,
    })
    .execute()
}

/** Remove one recovery token and its recorded address (an unsent link). */
export async function dropRecoveryLink(db: AuthDb, token: string): Promise<void> {
  await db
    .deleteFrom('verification')
    .where('identifier', 'in', [RESET_PREFIX + token, RECOVERY_EMAIL_PREFIX + token])
    .execute()
}

/**
 * Delete a user's recovery tokens and their recorded addresses, except the
 * token stored as `keep` (a full `reset-password:` identifier).
 */
export async function retireRecoveryLinks(db: AuthDb, userId: string, keep?: string) {
  const retired = await db
    .deleteFrom('verification')
    .where('identifier', 'like', `${RESET_PREFIX}%`)
    .where('value', '=', userId)
    .where('identifier', '<>', keep ?? '')
    .returning('identifier')
    .execute()
  if (retired.length === 0) return
  await db
    .deleteFrom('verification')
    .where(
      'identifier',
      'in',
      retired.map(
        ({ identifier }) => RECOVERY_EMAIL_PREFIX + identifier.slice(RESET_PREFIX.length),
      ),
    )
    .execute()
}
