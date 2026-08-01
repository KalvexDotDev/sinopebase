/**
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
import { createAuth, type OAuthProviderConfig, type SinopebaseAuth } from '../../src/tools/auth-better'
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
      google: { clientId: 'g-cid', clientSecret: 'g-cs' },
      github: { clientId: 'gh-cid', clientSecret: 'gh-cs' },
      discord: { clientId: 'd-cid', clientSecret: 'd-cs' },
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
  })
})
