/**
 * @new-code-test positive src/tools/auth-better/index.ts
 * @new-code-test negative src/tools/auth-better/index.ts
 * OAuth Config Mapping Contract Tests
 *
 * Verifies createAuth()'s provider splitting (src/tools/auth-better/index.ts):
 *   - Built-in social providerIds (google, github, discord, ...) go to
 *     better-auth's `socialProviders` option.
 *   - Everything else goes to the genericOAuth plugin, with `issuer` mapped
 *     to `discoveryUrl` (issuer + '/.well-known/openid-configuration',
 *     trailing slash stripped) and `tenantId` preserved.
 *   - With no providers configured, createAuth() succeeds with an empty set.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Pool } from 'pg'
import {
  createAuth,
  type OAuthProviderConfig,
  type SinopebaseAuth,
} from '../../src/tools/auth-better'
import { requirePostgres } from '../harness'

interface GenericOAuthPluginShape {
  id: string
  options?: { config?: Array<Record<string, unknown>> }
}

/** Extract the config array passed to the genericOAuth plugin, if any. */
function genericProviderConfigs(auth: SinopebaseAuth): Array<Record<string, unknown>> {
  const plugins = (auth.options.plugins ?? []) as unknown as GenericOAuthPluginShape[]
  const generic = plugins.find((p) => p.id === 'generic-oauth')
  return generic?.options?.config ?? []
}

describe('OAuth provider config mapping (createAuth)', () => {
  let pool: Pool

  beforeAll(async () => {
    pool = new Pool({ connectionString: requirePostgres() })
  })

  afterAll(async () => {
    await pool.end()
  })

  test('routes google/github/discord to socialProviders, not genericOAuth', async () => {
    const providers: OAuthProviderConfig[] = [
      { providerId: 'google', clientId: 'g-cid', clientSecret: 'g-cs' },
      { providerId: 'github', clientId: 'gh-cid', clientSecret: 'gh-cs' },
      { providerId: 'discord', clientId: 'd-cid', clientSecret: 'd-cs' },
    ]
    const auth = await createAuth(pool, { oauthProviders: providers })

    expect(auth.options.socialProviders).toEqual({
      google: { clientId: 'g-cid', clientSecret: 'g-cs', disableSignUp: false },
      github: { clientId: 'gh-cid', clientSecret: 'gh-cs', disableSignUp: false },
      discord: { clientId: 'd-cid', clientSecret: 'd-cs', disableSignUp: false },
    })
    expect(genericProviderConfigs(auth)).toEqual([])
  })

  test('routes non-built-in providers to genericOAuth with discoveryUrl from issuer', async () => {
    const auth = await createAuth(pool, {
      oauthProviders: [
        {
          providerId: 'keycloak',
          clientId: 'kc-cid',
          clientSecret: 'kc-cs',
          issuer: 'https://idp.example.com/realms/sinopebase/',
        },
        {
          providerId: 'okta',
          clientId: 'okta-cid',
          clientSecret: 'okta-cs',
          // No issuer → no discoveryUrl
        },
      ],
    })

    expect(auth.options.socialProviders).toBeUndefined()

    const configs = genericProviderConfigs(auth)
    expect(configs).toHaveLength(2)

    const keycloak = configs.find((c) => c.providerId === 'keycloak')
    expect(keycloak?.discoveryUrl).toBe(
      'https://idp.example.com/realms/sinopebase/.well-known/openid-configuration',
    )
    expect(keycloak).not.toHaveProperty('tenantId')

    const okta = configs.find((c) => c.providerId === 'okta')
    expect(okta).not.toHaveProperty('discoveryUrl')
  })

  test('preserves tenantId for Entra ID providers', async () => {
    const auth = await createAuth(pool, {
      oauthProviders: [
        {
          providerId: 'microsoft-entra-id',
          clientId: 'entra-cid',
          clientSecret: 'entra-cs',
          tenantId: 'contoso-12345',
          issuer: 'https://login.microsoftonline.com/contoso-12345/v2.0',
        },
      ],
    })

    const configs = genericProviderConfigs(auth)
    const entra = configs.find((c) => c.providerId === 'microsoft-entra-id')
    expect(entra?.tenantId).toBe('contoso-12345')
    expect(entra?.discoveryUrl).toBe(
      'https://login.microsoftonline.com/contoso-12345/v2.0/.well-known/openid-configuration',
    )
  })

  test('defaults to an empty provider set without errors', async () => {
    const auth = await createAuth(pool)

    expect(auth.options.socialProviders).toBeUndefined()
    expect(genericProviderConfigs(auth)).toEqual([])
    expect(auth.options.plugins).toEqual([])
    expect(auth.options.account?.accountLinking).toEqual({
      enabled: true,
      trustedProviders: [],
    })
    expect(auth.options.emailAndPassword?.enabled).toBe(true)
    expect(auth.options.emailVerification).toBeUndefined()
    expect(auth.options.trustedOrigins).toEqual(['http://localhost:8090', 'http://127.0.0.1:8090'])
    expect(auth.options.basePath).toBe('/api/auth')
    expect(auth.options.baseURL).toBe('http://localhost:8090')
    const generateId = auth.options.advanced?.database?.generateId as () => string
    const id = generateId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  test('keeps password reset and verification delivery configured', async () => {
    const sent: Array<{ to: string; subject: string; text: string; html?: string }> = []
    const auth = await createAuth(pool, {
      sendEmail: async (mail) => {
        sent.push(mail)
      },
    })
    const emailOptions = auth.options as unknown as {
      emailAndPassword: {
        sendResetPassword: (args: { user: { email: string }; url: string }) => Promise<void>
      }
      emailVerification: {
        sendVerificationEmail: (args: { user: { email: string }; url: string }) => Promise<void>
      }
    }

    await emailOptions.emailAndPassword.sendResetPassword({
      user: { email: 'owner@example.test' },
      url: 'https://example.test/reset',
    })
    await emailOptions.emailVerification.sendVerificationEmail({
      user: { email: 'owner@example.test' },
      url: 'https://example.test/verify',
    })

    expect(sent).toEqual([
      {
        to: 'owner@example.test',
        subject: 'Sinopebase password reset',
        text: 'Reset your password: https://example.test/reset',
        html: '<p>Reset your password: <a href="https://example.test/reset">https://example.test/reset</a></p>',
      },
      {
        to: 'owner@example.test',
        subject: 'Verify your email',
        text: 'Verify your email: https://example.test/verify',
      },
    ])
    expect(auth.options.emailAndPassword?.enabled).toBe(true)
    expect((auth.options.emailVerification as { enabled?: boolean })?.enabled).toBe(true)
  })

  test('preserves provider links, origin filtering, and operator overrides', async () => {
    const auth = await createAuth(pool, {
      jwtSecret: 'explicit-test-secret',
      extraOrigins: ['https://app.example.test', '', '*'],
      oauthProviders: [
        { providerId: 'google', clientId: 'google-id', clientSecret: 'google-secret' },
        { providerId: 'enterprise', clientId: 'enterprise-id', clientSecret: 'enterprise-secret' },
      ],
    })
    expect(auth.options.secret).toBe('explicit-test-secret')
    expect(auth.options.trustedOrigins).toEqual([
      'http://localhost:8090',
      'http://127.0.0.1:8090',
      'https://app.example.test',
    ])
    expect(auth.options.plugins).toHaveLength(1)
    expect(auth.options.plugins?.[0]?.id).toBe('generic-oauth')
    expect(auth.options.account?.accountLinking).toEqual({
      enabled: true,
      trustedProviders: ['google', 'enterprise'],
    })
  })

  test('selects the configured public auth URL before the app URL', async () => {
    const originalAuth = process.env.BETTER_AUTH_URL
    const originalApp = process.env.SINOPEBASE_URL
    try {
      process.env.BETTER_AUTH_URL = 'https://auth.example.test'
      process.env.SINOPEBASE_URL = 'https://app.example.test'
      expect((await createAuth(pool)).options.baseURL).toBe('https://auth.example.test')

      delete process.env.BETTER_AUTH_URL
      expect((await createAuth(pool)).options.baseURL).toBe('https://app.example.test')
    } finally {
      if (originalAuth === undefined) delete process.env.BETTER_AUTH_URL
      else process.env.BETTER_AUTH_URL = originalAuth
      if (originalApp === undefined) delete process.env.SINOPEBASE_URL
      else process.env.SINOPEBASE_URL = originalApp
    }
  })
})
