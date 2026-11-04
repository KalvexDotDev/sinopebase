// @new-code-test positive src/tools/auth-better/identity-linking-policy.ts
// @new-code-test negative src/tools/auth-better/identity-linking-policy.ts
import { describe, expect, it } from 'bun:test'
import {
  decideIdentityLink,
  microsoftAccountId,
  removeSignInMethod,
} from './identity-linking-policy'

const TID = '6fdb255f-0000-4000-8000-000000000001'
const HOSTILE_TID = '0bad0bad-0000-4000-8000-000000000002'
const OID = '11111111-2222-4333-8444-555555555555'

describe('decideIdentityLink: provider-verified email', () => {
  it('links a Google identity whose provider-verified email matches a verified account', () => {
    expect(
      decideIdentityLink(
        { providerId: 'google', emailVerified: true },
        { kind: 'email_match', userId: 'u1', emailVerified: true },
      ),
    ).toEqual({ action: 'link', userId: 'u1' })
  })

  it('refuses a Google identity whose email the provider has not verified', () => {
    expect(
      decideIdentityLink(
        { providerId: 'google', emailVerified: false },
        { kind: 'email_match', userId: 'u1', emailVerified: true },
      ),
    ).toEqual({ action: 'refuse', reason: 'provider_email_unverified' })
  })

  it('refuses to link into an account whose own email was never verified (pre-hijack)', () => {
    expect(
      decideIdentityLink(
        { providerId: 'google', emailVerified: true },
        { kind: 'email_match', userId: 'u1', emailVerified: false },
      ),
    ).toEqual({ action: 'refuse', reason: 'local_email_unverified' })
  })

  it('creates a user when no account owns the identity or the email', () => {
    expect(
      decideIdentityLink({ providerId: 'google', emailVerified: false }, { kind: 'none' }),
    ).toEqual({ action: 'create' })
  })

  it('signs in the owner of an already linked identity', () => {
    expect(
      decideIdentityLink(
        { providerId: 'google', emailVerified: false },
        { kind: 'identity_owner', userId: 'u1' },
      ),
    ).toEqual({ action: 'sign_in', userId: 'u1' })
  })
})

describe('decideIdentityLink: Microsoft (nOAuth)', () => {
  it('never links on a Microsoft email claim, even one marked verified', () => {
    // A hostile Entra tenant can put any address in the email claim.
    expect(
      decideIdentityLink(
        { providerId: 'microsoft', emailVerified: true },
        { kind: 'email_match', userId: 'victim', emailVerified: true },
      ),
    ).toEqual({ action: 'refuse', reason: 'email_claim_not_authoritative' })
  })

  it.each(['microsoft-entra-id', 'keycloak', 'github'])(
    'never links on the email claim of any provider but Google (%s)',
    (providerId) => {
      expect(
        decideIdentityLink(
          { providerId, emailVerified: true },
          { kind: 'email_match', userId: 'victim', emailVerified: true },
        ),
      ).toEqual({ action: 'refuse', reason: 'email_claim_not_authoritative' })
    },
  )

  it('signs in only the user who owns the tenant and object identity', () => {
    expect(
      decideIdentityLink(
        { providerId: 'microsoft', emailVerified: false },
        { kind: 'identity_owner', userId: 'u1' },
      ),
    ).toEqual({ action: 'sign_in', userId: 'u1' })
  })
})

describe('decideIdentityLink: explicit link by the signed-in user', () => {
  it('links any provider to the signed-in user regardless of the email claim', () => {
    for (const providerId of ['google', 'microsoft'])
      expect(
        decideIdentityLink({ providerId, emailVerified: false }, { kind: 'none' }, 'me'),
      ).toEqual({ action: 'link', userId: 'me' })
  })

  it('refuses an identity already linked to another user', () => {
    expect(
      decideIdentityLink(
        { providerId: 'google', emailVerified: true },
        { kind: 'identity_owner', userId: 'someone-else' },
        'me',
      ),
    ).toEqual({ action: 'refuse', reason: 'identity_linked_to_another_user' })
  })

  it('treats re-linking an identity the user already owns as a sign-in', () => {
    expect(
      decideIdentityLink(
        { providerId: 'google', emailVerified: true },
        { kind: 'identity_owner', userId: 'me' },
        'me',
      ),
    ).toEqual({ action: 'sign_in', userId: 'me' })
  })
})

describe('microsoftAccountId', () => {
  it('keys a Microsoft identity on tenant ID plus object ID', () => {
    expect(microsoftAccountId({ tid: TID, oid: OID, email: 'a@example.com' })).toBe(`${TID}:${OID}`)
  })

  it('gives the same object ID in another tenant a different key', () => {
    expect(microsoftAccountId({ tid: HOSTILE_TID, oid: OID })).not.toBe(
      microsoftAccountId({ tid: TID, oid: OID }),
    )
  })

  it('ignores the email claim entirely', () => {
    expect(microsoftAccountId({ tid: TID, oid: OID, email: 'victim@example.com' })).toBe(
      microsoftAccountId({ tid: TID, oid: OID, email: 'attacker@example.com' }),
    )
  })

  it.each([
    [{ oid: OID }],
    [{ tid: TID }],
    [{ tid: TID, oid: '' }],
    [{ tid: 'not-a-guid', oid: OID }],
    [{ tid: TID, oid: 42 }],
  ])('refuses a profile without valid tid and oid: %j', (profile) => {
    expect(() => microsoftAccountId(profile)).toThrow('Microsoft identity requires tid and oid')
  })
})

describe('removeSignInMethod: last-method guard', () => {
  const password = { id: 'cred', provider: 'email' }
  const google = { id: 'g', provider: 'google' }

  it('removes a method while another remains', () => {
    expect(removeSignInMethod([password, google], 'g')).toEqual({ allowed: true, method: google })
    expect(removeSignInMethod([password, google], 'cred')).toEqual({
      allowed: true,
      method: password,
    })
  })

  it('refuses to remove the last sign-in method', () => {
    expect(removeSignInMethod([google], 'g')).toEqual({
      allowed: false,
      reason: 'last_sign_in_method',
    })
  })

  it('refuses a method the user does not have', () => {
    expect(removeSignInMethod([password, google], 'other')).toEqual({
      allowed: false,
      reason: 'not_found',
    })
  })
})
