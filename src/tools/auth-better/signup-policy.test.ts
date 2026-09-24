import { afterEach, describe, expect, it } from 'bun:test'
import { buildOAuthProviderConfigs } from './index'

const providers = [
  { providerId: 'google', clientId: 'google-id', clientSecret: 'test-google-secret' },
  {
    providerId: 'enterprise',
    clientId: 'oidc-id',
    clientSecret: 'test-oidc-secret',
    issuer: 'https://id.example.test/',
  },
]

describe('OAuth signup policy', () => {
  const originalSignup = process.env.ALLOW_SIGNUPS
  const originalProduction = process.env.SINOPEBASE_PRODUCTION

  afterEach(() => {
    if (originalSignup === undefined) delete process.env.ALLOW_SIGNUPS
    else process.env.ALLOW_SIGNUPS = originalSignup
    if (originalProduction === undefined) delete process.env.SINOPEBASE_PRODUCTION
    else process.env.SINOPEBASE_PRODUCTION = originalProduction
  })

  it('disables new-user creation for built-in and generic callbacks when signup is closed', () => {
    process.env.SINOPEBASE_PRODUCTION = 'true'
    delete process.env.ALLOW_SIGNUPS
    const config = buildOAuthProviderConfigs(providers)
    expect(config.socialProviders.google?.disableSignUp).toBe(true)
    expect(config.genericConfigs[0]?.disableSignUp).toBe(true)
    expect(config.genericConfigs[0]?.discoveryUrl).toBe(
      'https://id.example.test/.well-known/openid-configuration',
    )
  })

  it('preserves existing-provider sign-in configuration when signup is explicitly enabled', () => {
    process.env.SINOPEBASE_PRODUCTION = 'true'
    process.env.ALLOW_SIGNUPS = 'true'
    const config = buildOAuthProviderConfigs(providers)
    expect(config.socialProviders.google).toEqual({
      clientId: 'google-id',
      clientSecret: 'test-google-secret',
      disableSignUp: false,
    })
    expect(config.genericConfigs[0]?.disableSignUp).toBe(false)
  })
})
