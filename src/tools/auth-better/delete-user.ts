// ---------------------------------------------------------------------------
// Self-service account deletion (sinope#1189), GoTrue soft-delete style
//
// The user row stays as a tombstone: records elsewhere in the database keep
// naming its id, so a hard delete would either cascade those records away or
// be refused by their foreign keys. Everything that identifies the person or
// lets anyone act as them goes: the address (obfuscated, so it can be invited
// again), name and metadata, every credential and linked identity, every
// session and refresh token, every pending emailed link and every agent grant.
// ---------------------------------------------------------------------------

import type { Kysely } from 'kysely'
import type { BetterAuthDatabase } from './adapter'
import { revokeUserAgentGrants } from './agent-grants'
import { retireEmailChanges } from './email-change'
import { RECOVERY_SENT_PREFIX, retireRecoveryLinks } from './recovery-links'

/** How recently the deleting session must have signed in (Better Auth `freshAge` semantics). */
export const REAUTHENTICATION_WINDOW_MS = 10 * 60_000

/** The tombstone's address: unique, undeliverable, and free of the person's own. */
export function deletedEmail(userId: string): string {
  return `deleted-${userId}@deleted.invalid`
}

/** Delete the user's account in the caller's transaction. Deployment triggers may refuse it. */
export async function tombstoneUser(db: Kysely<BetterAuthDatabase>, userId: string): Promise<void> {
  // First, so a deployment's refusal (a trigger on the user row) leaves nothing half-done.
  await db
    .updateTable('user')
    .set({
      email: deletedEmail(userId),
      emailVerified: false,
      name: null,
      image: null,
      userMetadata: {},
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where('id', '=', userId)
    .executeTakeFirstOrThrow()
  await revokeUserAgentGrants(db, userId)
  await retireRecoveryLinks(db, userId)
  await db
    .deleteFrom('verification')
    .where('identifier', '=', RECOVERY_SENT_PREFIX + userId)
    .execute()
  await retireEmailChanges(db, userId)
  await db.deleteFrom('refresh_tokens').where('user_id', '=', userId).execute()
  await db.deleteFrom('session').where('userId', '=', userId).execute()
  await db.deleteFrom('account').where('userId', '=', userId).execute()
}
