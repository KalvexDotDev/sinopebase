import type { OAuthProviderConfig } from '~/tools/auth-better'

function oauthProvidersFromJson(value: string | undefined): OAuthProviderConfig[] {
  if (!value) return []
  const parsed: unknown = JSON.parse(value)
  if (
    !Array.isArray(parsed) ||
    !parsed.every(
      (provider) =>
        provider &&
        typeof provider === 'object' &&
        typeof provider.providerId === 'string' &&
        typeof provider.clientId === 'string' &&
        typeof provider.clientSecret === 'string',
    )
  ) {
    throw new Error(
      'SINOPEBASE_OAUTH_PROVIDERS_JSON must be an array of OAuth provider configurations',
    )
  }
  return parsed as OAuthProviderConfig[]
}

/** A provider from `<PREFIX>_CLIENT_ID` + `<PREFIX>_CLIENT_SECRET`; both or neither. */
function namedProvider(
  env: NodeJS.ProcessEnv,
  providerId: string,
  prefix: string,
): OAuthProviderConfig[] {
  const clientId = env[`${prefix}_CLIENT_ID`]
  const clientSecret = env[`${prefix}_CLIENT_SECRET`]
  if (!clientId && !clientSecret) return []
  if (!clientId || !clientSecret)
    throw new Error(`${prefix}_CLIENT_ID and ${prefix}_CLIENT_SECRET must be set together`)
  const tenantId = env[`${prefix}_TENANT_ID`]
  return [{ providerId, clientId, clientSecret, ...(tenantId ? { tenantId } : {}) }]
}

/**
 * OAuth providers from SINOPEBASE_OAUTH_PROVIDERS_JSON plus Google and Microsoft
 * sign-in from GOOGLE_* and MICROSOFT_* (AZURE_CLIENT_ID is the managed identity's).
 * A provider configured twice, or half-configured, refuses startup.
 */
export function oauthProvidersFromEnv(env: NodeJS.ProcessEnv): OAuthProviderConfig[] {
  const providers = [
    ...oauthProvidersFromJson(env.SINOPEBASE_OAUTH_PROVIDERS_JSON),
    ...namedProvider(env, 'google', 'GOOGLE'),
    ...namedProvider(env, 'microsoft', 'MICROSOFT'),
  ]
  const ids = providers.map((p) => p.providerId)
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index)
  if (duplicate) throw new Error(`OAuth provider ${duplicate} is configured twice`)
  return providers
}
