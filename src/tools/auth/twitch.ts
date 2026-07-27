/**
 * Twitch OAuth2 provider (stub).
 *
 * Port of github.com/pocketbase/pocketbase/tree/master/tools/auth/twitch.go
 * Layer 1 -- depends on BaseProvider.
 *
 * TODO: Complete the user field mapping implementation.
 * The OAuth2 flow works (auth URL, token exchange, refresh),
 * but FetchUser returns an empty AuthUser skeleton.
 *
 * Endpoints:
 *   - Auth:  https://id.twitch.tv/oauth2/authorize
 *   - Token: https://id.twitch.tv/oauth2/token
 *   - User:  https://api.twitch.tv/helix/users
 *
 * Default scopes: user:read:email
 */

import { BaseProvider } from '~/tools/auth/base_provider.ts'
// import type { AuthUser } from '~/tools/auth/auth.ts'

/**
 * TwitchProvider implements OAuth2 authentication via Twitch.
 *
 * TODO: Implement MapUser() with the correct field mappings from
 *       the https://api.twitch.tv/helix/users response.
 *
 * @example
 *
 */
export class TwitchProvider extends BaseProvider {
  constructor(clientId: string, clientSecret: string, redirectUrl: string) {
    super(
      clientId,
      clientSecret,
      redirectUrl,
      'https://id.twitch.tv/oauth2/authorize',
      'https://id.twitch.tv/oauth2/token',
      'https://api.twitch.tv/helix/users',
      ['user:read:email'],
    )
  }

  override DisplayName(): string {
    return 'twitch'
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
