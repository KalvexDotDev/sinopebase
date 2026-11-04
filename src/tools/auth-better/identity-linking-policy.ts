// ---------------------------------------------------------------------------
// Identity Linking Policy (sinope#1097)
//
// Decides what a provider identity may do: sign in its owner, create a user,
// link to an existing user, or be refused with a reason. Pure: the Better Auth
// wiring in ./index.ts supplies the facts and enforces the decision.
//
// - Implicit linking (a sign-in whose email matches an existing user) needs a
//   provider-verified email AND a verified local email; otherwise an attacker
//   could take over, or pre-register, the account.
// - Only providers on an allowlist (Google) have an authoritative email claim.
//   Microsoft identities are keyed on tid + oid and their email claim is never
//   authoritative (nOAuth: any Entra tenant can assert any address); neither
//   it nor any other provider (generic OIDC, GitHub, ...) links implicitly.
// - A signed-in user may link any identity not owned by someone else.
// - A user can never remove their last sign-in method.
// ---------------------------------------------------------------------------

export interface ProviderIdentity {
  providerId: string
  /** The provider's own verification of the email it asserts. */
  emailVerified: boolean
}

/** What already exists for this identity. */
export type ExistingAccount =
  | { kind: 'none' }
  /** The provider identity (provider + account key) is already linked. */
  | { kind: 'identity_owner'; userId: string }
  /** No linked identity, but a user has the email the provider asserts. */
  | { kind: 'email_match'; userId: string; emailVerified: boolean }

export type LinkRefusal =
  | 'email_claim_not_authoritative'
  | 'provider_email_unverified'
  | 'local_email_unverified'
  | 'identity_linked_to_another_user'

export type IdentityLinkDecision =
  | { action: 'sign_in'; userId: string }
  | { action: 'create' }
  | { action: 'link'; userId: string }
  | { action: 'refuse'; reason: LinkRefusal }

/** Providers whose verified email claim identifies a Sinope user. */
const EMAIL_AUTHORITATIVE: ReadonlySet<string> = new Set(['google'])

/**
 * @param signedInUserId the user explicitly linking from their account, if any
 */
export function decideIdentityLink(
  identity: ProviderIdentity,
  existing: ExistingAccount,
  signedInUserId?: string,
): IdentityLinkDecision {
  if (existing.kind === 'identity_owner') return ownedIdentity(existing.userId, signedInUserId)
  if (signedInUserId) return { action: 'link', userId: signedInUserId }
  if (existing.kind === 'none') return { action: 'create' }
  return implicitLink(identity, existing)
}

/** An identity already linked signs in only its owner. */
function ownedIdentity(ownerId: string, signedInUserId?: string): IdentityLinkDecision {
  if (signedInUserId && signedInUserId !== ownerId)
    return { action: 'refuse', reason: 'identity_linked_to_another_user' }
  return { action: 'sign_in', userId: ownerId }
}

/** Linking on a matching email needs an authoritative, verified claim and a verified account. */
function implicitLink(
  identity: ProviderIdentity,
  existing: Extract<ExistingAccount, { kind: 'email_match' }>,
): IdentityLinkDecision {
  if (!EMAIL_AUTHORITATIVE.has(identity.providerId))
    return { action: 'refuse', reason: 'email_claim_not_authoritative' }
  if (!identity.emailVerified) return { action: 'refuse', reason: 'provider_email_unverified' }
  if (!existing.emailVerified) return { action: 'refuse', reason: 'local_email_unverified' }
  return { action: 'link', userId: existing.userId }
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Account key of a Microsoft identity: `<tid>:<oid>`, never the email claim. */
export function microsoftAccountId(profile: Record<string, unknown>): string {
  const { tid, oid } = profile
  if (typeof tid !== 'string' || typeof oid !== 'string' || !GUID.test(tid) || !GUID.test(oid))
    throw new Error('Microsoft identity requires tid and oid')
  return `${tid.toLowerCase()}:${oid.toLowerCase()}`
}

export interface SignInMethod {
  id: string
  provider: string
}

export type SignInMethodRemoval =
  | { allowed: true; method: SignInMethod }
  | { allowed: false; reason: 'not_found' | 'last_sign_in_method' }

/** Last-method guard: the user must keep at least one way in. */
export function removeSignInMethod(methods: SignInMethod[], id: string): SignInMethodRemoval {
  const method = methods.find((m) => m.id === id)
  if (!method) return { allowed: false, reason: 'not_found' }
  if (methods.length < 2) return { allowed: false, reason: 'last_sign_in_method' }
  return { allowed: true, method }
}
