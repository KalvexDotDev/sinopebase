// ---------------------------------------------------------------------------
// GoTrue email change on Better Auth's verification table
//
// PUT /auth/v1/user { email } does not change the address. It stages one
// pending change per user and mails a single-use link to the new address;
// POST /auth/v1/verify (type=email_change) applies it. The row stores only the
// token's SHA-256, with the user, the address the change was requested from
// and the requested address, so a link dies once the account address changes
// by any other route.
// ---------------------------------------------------------------------------

import type { Kysely } from 'kysely'
import { z } from 'zod'
import type { BetterAuthDatabase } from './adapter'

/** Identifier prefix of a pending email change; the suffix is the token's SHA-256. */
export const EMAIL_CHANGE_PREFIX = 'email-change:'
/** Better Auth's emailVerification.expiresIn default (one hour), as for recovery links. */
const EMAIL_CHANGE_TTL_MS = 60 * 60 * 1000
/** GoTrue SMTP_MAX_FREQUENCY default: one email-change mail per user per 60 seconds. */
export const EMAIL_CHANGE_INTERVAL_MS = 60_000

type AuthDb = Kysely<BetterAuthDatabase>

/** Row value: JSON `[userId, fromEmail, toEmail]`, both addresses lower-cased. */
const pendingValue = z.tuple([z.string().min(1), z.string().email(), z.string().email()])

export interface PendingEmailChange {
  userId: string
  from: string
  to: string
}

function identifierFor(token: string): string {
  return EMAIL_CHANGE_PREFIX + new Bun.CryptoHasher('sha256').update(token).digest('hex')
}

/** LIKE prefix selecting one user's rows: the value starts `["<userId>",`. */
function userValuePrefix(userId: string): string {
  return `${JSON.stringify([userId]).slice(0, -1)},%`
}

/** The user's pending change sent within the last interval, if any. */
export async function recentEmailChange(db: AuthDb, userId: string): Promise<boolean> {
  const recent = await db
    .selectFrom('verification')
    .select('id')
    .where('identifier', 'like', `${EMAIL_CHANGE_PREFIX}%`)
    .where('value', 'like', userValuePrefix(userId))
    .where('createdAt', '>', new Date(Date.now() - EMAIL_CHANGE_INTERVAL_MS))
    .executeTakeFirst()
  return recent !== undefined
}

/** Delete every pending email change of the user. */
export async function retireEmailChanges(db: AuthDb, userId: string): Promise<void> {
  await db
    .deleteFrom('verification')
    .where('identifier', 'like', `${EMAIL_CHANGE_PREFIX}%`)
    .where('value', 'like', userValuePrefix(userId))
    .execute()
}

/**
 * Replace the user's pending change with a new one and return its token.
 * GoTrue keeps a single email-change token per user.
 */
export async function stageEmailChange(
  db: AuthDb,
  change: PendingEmailChange,
): Promise<{ token: string; sentAt: Date }> {
  await retireEmailChanges(db, change.userId)
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url')
  const sentAt = new Date()
  await db
    .insertInto('verification')
    .values({
      id: crypto.randomUUID(),
      identifier: identifierFor(token),
      value: JSON.stringify([change.userId, change.from, change.to]),
      expiresAt: new Date(sentAt.getTime() + EMAIL_CHANGE_TTL_MS),
      createdAt: sentAt,
      updatedAt: sentAt,
    })
    .execute()
  return { token, sentAt }
}

/** Remove an unsent link, so a failed delivery leaves nothing usable or throttled. */
export async function dropEmailChange(db: AuthDb, token: string): Promise<void> {
  await db.deleteFrom('verification').where('identifier', '=', identifierFor(token)).execute()
}

/** The pending change a live token names, without using it up. */
export async function pendingEmailChange(
  db: AuthDb,
  token: string,
): Promise<PendingEmailChange | undefined> {
  const row = await db
    .selectFrom('verification')
    .select('value')
    .where('identifier', '=', identifierFor(token))
    .where('expiresAt', '>', new Date())
    .executeTakeFirst()
  if (!row) return undefined
  const [userId, from, to] = pendingValue.parse(JSON.parse(row.value))
  return { userId, from, to }
}

/**
 * Use up a token. Callers lock the user row first, as every writer of these
 * rows does; false when a concurrent request used or replaced it meanwhile.
 */
export async function consumeEmailChange(db: AuthDb, token: string): Promise<boolean> {
  const used = await db
    .deleteFrom('verification')
    .where('identifier', '=', identifierFor(token))
    .where('expiresAt', '>', new Date())
    .returning('id')
    .executeTakeFirst()
  return used !== undefined
}
