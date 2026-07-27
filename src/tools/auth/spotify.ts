/**
 * Spotify OAuth2 provider (stub).
 *
 * Port of github.com/pocketbase/pocketbase/tree/master/tools/auth/spotify.go
 * Layer 1 -- depends on BaseProvider.
 *
 * TODO: Complete the user field mapping implementation.
 * The OAuth2 flow works (auth URL, token exchange, refresh),
 * but FetchUser returns an empty AuthUser skeleton.
 *
 * Endpoints:
 *   - Auth:  https://accounts.spotify.com/authorize
 *   - Token: https://accounts.spotify.com/api/token
 *   - User:  https://api.spotify.com/v1/me
 *
 * Default scopes: user-read-email user-read-private
 */

import { BaseProvider } from '~/tools/auth/base_provider.ts'
// import type { AuthUser } from '~/tools/auth/auth.ts'

/**
 * SpotifyProvider implements OAuth2 authentication via Spotify.
 *
 * TODO: Implement MapUser() with the correct field mappings from
 *       the https://api.spotify.com/v1/me response.
 *
 * @example
 *
 */
export class SpotifyProvider extends BaseProvider {
  constructor(clientId: string, clientSecret: string, redirectUrl: string) {
    super(
      clientId,
      clientSecret,
      redirectUrl,
      'https://accounts.spotify.com/authorize',
      'https://accounts.spotify.com/api/token',
      'https://api.spotify.com/v1/me',
      ['user-read-email', 'user-read-private'],
    )
  }

  override DisplayName(): string {
    return 'spotify'
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
