/**
 * Trakt OAuth2 provider (stub).
 *
 * Port of github.com/pocketbase/pocketbase/tree/master/tools/auth/trakt.go
 * Layer 1 -- depends on BaseProvider.
 *
 * TODO: Complete the user field mapping implementation.
 * The OAuth2 flow works (auth URL, token exchange, refresh),
 * but FetchUser returns an empty AuthUser skeleton.
 *
 * Endpoints:
 *   - Auth:  https://trakt.tv/oauth/authorize
 *   - Token: https://trakt.tv/oauth/token
 *   - User:  https://api.trakt.tv/users/me
 *
 * Default scopes: none
 */

import { BaseProvider } from '~/tools/auth/base_provider.ts'
// import type { AuthUser } from '~/tools/auth/auth.ts'

/**
 * TraktProvider implements OAuth2 authentication via Trakt.
 *
 * TODO: Implement MapUser() with the correct field mappings from
 *       the https://api.trakt.tv/users/me response.
 *
 * @example
 *
 */
export class TraktProvider extends BaseProvider {
  constructor(clientId: string, clientSecret: string, redirectUrl: string) {
    super(
      clientId,
      clientSecret,
      redirectUrl,
      'https://trakt.tv/oauth/authorize',
      'https://trakt.tv/oauth/token',
      'https://api.trakt.tv/users/me',
      [],
    )
  }

  override DisplayName(): string {
    return 'trakt'
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
