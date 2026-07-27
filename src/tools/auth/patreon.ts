/**
 * Patreon OAuth2 provider (stub).
 *
 * Port of github.com/pocketbase/pocketbase/tree/master/tools/auth/patreon.go
 * Layer 1 -- depends on BaseProvider.
 *
 * TODO: Complete the user field mapping implementation.
 * The OAuth2 flow works (auth URL, token exchange, refresh),
 * but FetchUser returns an empty AuthUser skeleton.
 *
 * Endpoints:
 *   - Auth:  https://www.patreon.com/oauth2/authorize
 *   - Token: https://www.patreon.com/api/oauth2/token
 *   - User:  https://www.patreon.com/api/oauth2/v2/identity
 *
 * Default scopes: identity identity[email]
 */

import { BaseProvider } from '~/tools/auth/base_provider.ts'
// import type { AuthUser } from '~/tools/auth/auth.ts'

/**
 * PatreonProvider implements OAuth2 authentication via Patreon.
 *
 * TODO: Implement MapUser() with the correct field mappings from
 *       the https://www.patreon.com/api/oauth2/v2/identity response.
 *
 * @example
 *
 */
export class PatreonProvider extends BaseProvider {
  constructor(clientId: string, clientSecret: string, redirectUrl: string) {
    super(
      clientId,
      clientSecret,
      redirectUrl,
      'https://www.patreon.com/oauth2/authorize',
      'https://www.patreon.com/api/oauth2/token',
      'https://www.patreon.com/api/oauth2/v2/identity',
      ['identity', 'identity[email]'],
    )
  }

  override DisplayName(): string {
    return 'patreon'
  }

  // override MapUser(rawUser: unknown): AuthUser {
  //   const data = rawUser as Record<string, unknown>
  //   return {
  //     Id: (data.id as string) ?? '',
  //     Name: (data.name as string) ?? '',
  //     Username: (data.login as string) ?? (data.email as string) ?? '',
  //     Email: (data.email as string) ?? '',
  //     AvatarUrl: (data.avatar_url as string) ?? (data.picture as string) ?? '',
  //     RawUser: rawUser,
  //   }
  // }
}
