// @new-code-test positive cmd/oauth-providers.ts
// @new-code-test negative cmd/oauth-providers.ts
import { describe, expect, it } from 'bun:test'
import { oauthProvidersFromEnv } from './oauth-providers'

describe('oauthProvidersFromEnv', () => {
  it('configures nothing without provider env', () => {
    expect(oauthProvidersFromEnv({})).toEqual([])
  })

  it('reads Google and Microsoft sign-in from GOOGLE_* and MICROSOFT_*', () => {
    expect(
      oauthProvidersFromEnv({
        GOOGLE_CLIENT_ID: 'g-id',
        GOOGLE_CLIENT_SECRET: 'g-secret',
        MICROSOFT_CLIENT_ID: 'm-id',
        MICROSOFT_CLIENT_SECRET: 'm-secret',
        MICROSOFT_TENANT_ID: 'organizations',
        // The blob managed identity, never a sign-in client.
        AZURE_CLIENT_ID: 'managed-identity',
      }),
    ).toEqual([
      { providerId: 'google', clientId: 'g-id', clientSecret: 'g-secret' },
      {
        providerId: 'microsoft',
        clientId: 'm-id',
        clientSecret: 'm-secret',
        tenantId: 'organizations',
      },
    ])
  })

  it('keeps SINOPEBASE_OAUTH_PROVIDERS_JSON providers alongside', () => {
    expect(
      oauthProvidersFromEnv({
        SINOPEBASE_OAUTH_PROVIDERS_JSON: JSON.stringify([
          { providerId: 'github', clientId: 'h-id', clientSecret: 'h-secret' },
        ]),
        GOOGLE_CLIENT_ID: 'g-id',
        GOOGLE_CLIENT_SECRET: 'g-secret',
      }).map((p) => p.providerId),
    ).toEqual(['github', 'google'])
  })

  it('refuses a half-configured provider', () => {
    expect(() => oauthProvidersFromEnv({ MICROSOFT_CLIENT_ID: 'm-id' })).toThrow(
      'MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET must be set together',
    )
  })

  it('refuses a provider configured twice', () => {
    expect(() =>
      oauthProvidersFromEnv({
        SINOPEBASE_OAUTH_PROVIDERS_JSON: JSON.stringify([
          { providerId: 'google', clientId: 'a', clientSecret: 'b' },
        ]),
        GOOGLE_CLIENT_ID: 'g-id',
        GOOGLE_CLIENT_SECRET: 'g-secret',
      }),
    ).toThrow('OAuth provider google is configured twice')
  })

  it('refuses malformed provider JSON', () => {
    expect(() => oauthProvidersFromEnv({ SINOPEBASE_OAUTH_PROVIDERS_JSON: '{}' })).toThrow(
      'SINOPEBASE_OAUTH_PROVIDERS_JSON must be an array',
    )
  })
})
