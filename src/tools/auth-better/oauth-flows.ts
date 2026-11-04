// ---------------------------------------------------------------------------
// GoTrue OAuth (PKCE) flow state on Better Auth's verification table
//
// GET /auth/v1/authorize starts a flow bound to the browser by a cookie;
// Better Auth runs the provider round trip; /auth/v1/oauth/complete turns the
// resulting session into a single-use auth code for redirect_to; and
// POST /auth/v1/token?grant_type=pkce redeems it with the code verifier.
// Linking (GET /auth/v1/user/identities/authorize) is server-to-server, so it
// first mints a single-use link ticket the browser then opens.
//
// Rows store only SHA-256 digests of flow ids, tickets and codes, and session
// ids rather than session tokens.
// ---------------------------------------------------------------------------

import type { Kysely } from 'kysely'
import { z } from 'zod'
import type { BetterAuthDatabase } from './adapter'

type AuthDb = Kysely<BetterAuthDatabase>

const FLOW_PREFIX = 'gotrue-oauth-flow:'
const LINK_TICKET_PREFIX = 'gotrue-oauth-link:'
const CODE_PREFIX = 'gotrue-oauth-code:'
const PENDING_LINK_PREFIX = 'gotrue-oauth-pending-link:'
/** Better Auth's own OAuth state lives ten minutes; the flow matches it. */
const FLOW_TTL_MS = 10 * 60 * 1000
/** The browser opens a link ticket immediately after the server mints it. */
const LINK_TICKET_TTL_MS = 2 * 60 * 1000
/** GoTrue's flow-state expiry for the auth code exchange. */
const CODE_TTL_MS = 5 * 60 * 1000

const flowRequest = z.object({
  provider: z.string().min(1),
  redirectTo: z.string().url(),
  /** PKCE S256 challenge from the client. */
  challenge: z.string().min(43).max(128),
  /** Explicit link: the signed-in user's session, which also receives the code. */
  linkSessionId: z.string().min(1).optional(),
})
export type FlowRequest = z.infer<typeof flowRequest>

const flowValue = flowRequest.extend({
  /** SHA-256 of the browser-binding cookie. */
  binding: z.string().length(64),
  startedAt: z.number().int(),
})
export type OAuthFlow = z.infer<typeof flowValue>

const codeValue = z.object({
  sessionId: z.string().min(1),
  challenge: z.string(),
  pendingAccountId: z.string().min(1).optional(),
})

export function sha256Hex(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex')
}

/** base64url(SHA-256(verifier)), the RFC 7636 S256 transform. */
export function s256Challenge(verifier: string): string {
  return new Bun.CryptoHasher('sha256').update(verifier).digest('base64url')
}

export function randomToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
}

async function store(db: AuthDb, identifier: string, value: unknown, ttlMs: number) {
  const now = new Date()
  await db
    .insertInto('verification')
    .values({
      id: crypto.randomUUID(),
      identifier,
      value: JSON.stringify(value),
      expiresAt: new Date(now.getTime() + ttlMs),
      createdAt: now,
      updatedAt: now,
    })
    .execute()
}

/** Delete and return a live row's value: every flow artefact is single-use. */
async function take<T>(db: AuthDb, identifier: string, schema: z.ZodType<T>): Promise<T | null> {
  const row = await db
    .deleteFrom('verification')
    .where('identifier', '=', identifier)
    .returning(['value', 'expiresAt'])
    .executeTakeFirst()
  if (!row || row.expiresAt <= new Date()) return null
  const parsed = schema.safeParse(JSON.parse(row.value))
  return parsed.success ? parsed.data : null
}

/** Start a flow bound to `binding` (the cookie value); returns the flow id. */
export async function createFlow(db: AuthDb, request: FlowRequest, binding: string) {
  const flowId = randomToken()
  const value: OAuthFlow = { ...request, binding: sha256Hex(binding), startedAt: Date.now() }
  await store(db, FLOW_PREFIX + sha256Hex(flowId), value, FLOW_TTL_MS)
  return flowId
}

/** Consume a flow; null unless it is live and the browser presents its binding. */
export async function takeFlow(db: AuthDb, flowId: string, binding: string | undefined) {
  const flow = await take(db, FLOW_PREFIX + sha256Hex(flowId), flowValue)
  return flow && binding && flow.binding === sha256Hex(binding) ? flow : null
}

export async function createLinkTicket(db: AuthDb, request: FlowRequest) {
  const ticket = randomToken()
  await store(db, LINK_TICKET_PREFIX + sha256Hex(ticket), request, LINK_TICKET_TTL_MS)
  return ticket
}

export function takeLinkTicket(db: AuthDb, ticket: string) {
  return take(db, LINK_TICKET_PREFIX + sha256Hex(ticket), flowRequest)
}

export async function createAuthCode(
  db: AuthDb,
  sessionId: string,
  challenge: string,
  pendingAccountId?: string,
) {
  const code = randomToken()
  await store(
    db,
    CODE_PREFIX + sha256Hex(code),
    { sessionId, challenge, pendingAccountId },
    CODE_TTL_MS,
  )
  return code
}

export function takeAuthCode(db: AuthDb, code: string) {
  return take(db, CODE_PREFIX + sha256Hex(code), codeValue)
}

// A new link is pending until its code is redeemed with the verifier. A link
// ticket can be opened by any browser, so only redemption proves that the
// browser that asked to link is the one that signed in at the provider.

/** Hold a newly linked account until its code is redeemed. */
export function holdLink(db: AuthDb, accountId: string) {
  return store(db, PENDING_LINK_PREFIX + accountId, {}, CODE_TTL_MS)
}

/** Release a link's hold: the link stays. */
async function releaseLink(db: AuthDb, accountId: string) {
  await db
    .deleteFrom('verification')
    .where('identifier', '=', PENDING_LINK_PREFIX + accountId)
    .execute()
}

/** Remove a link that was never proven, with its hold. */
async function dropLink(db: AuthDb, accountId: string) {
  await db.deleteFrom('account').where('id', '=', accountId).execute()
  await releaseLink(db, accountId)
}

/** Settle a held link at redemption: kept when the verifier proved it, otherwise removed. */
export function settleLink(db: AuthDb, accountId: string, proven: boolean) {
  return proven ? releaseLink(db, accountId) : dropLink(db, accountId)
}

/**
 * Whether any of these accounts is a link still waiting for redemption. Holds
 * past their deadline are abandoned: their links are removed here.
 */
export async function heldLinks(db: AuthDb, accountIds: string[]): Promise<boolean> {
  if (accountIds.length === 0) return false
  const holds = await db
    .selectFrom('verification')
    .select(['identifier', 'expiresAt'])
    .where(
      'identifier',
      'in',
      accountIds.map((id) => PENDING_LINK_PREFIX + id),
    )
    .execute()
  for (const hold of holds)
    if (hold.expiresAt <= new Date())
      await dropLink(db, hold.identifier.slice(PENDING_LINK_PREFIX.length))
  return holds.length > 0
}
