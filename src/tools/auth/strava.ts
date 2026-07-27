/**
 * Strava OAuth2 provider (stub).
 *
 * Port of github.com/pocketbase/pocketbase/tree/master/tools/auth/strava.go
 * Layer 1 -- depends on BaseProvider.
 *
 * TODO: Complete the user field mapping implementation.
 * The OAuth2 flow works (auth URL, token exchange, refresh),
 * but FetchUser returns an empty AuthUser skeleton.
 *
 * Endpoints:
 *   - Auth:  https://www.strava.com/oauth/authorize
 *   - Token: https://www.strava.com/oauth/token
 *   - User:  https://www.strava.com/api/v3/athlete
 *
 * Default scopes: read
 */

import { BaseProvider } from '~/tools/auth/base_provider.ts'
// import type { AuthUser } from '~/tools/auth/auth.ts'

/**
 * StravaProvider implements OAuth2 authentication via Strava.
 *
 * TODO: Implement MapUser() with the correct field mappings from
 *       the https://www.strava.com/api/v3/athlete response.
 *
 * @example
 *
 */
export class StravaProvider extends BaseProvider {
  constructor(clientId: string, clientSecret: string, redirectUrl: string) {
    super(
      clientId,
      clientSecret,
      redirectUrl,
      'https://www.strava.com/oauth/authorize',
      'https://www.strava.com/oauth/token',
      'https://www.strava.com/api/v3/athlete',
      ['read'],
    )
  }

  override DisplayName(): string {
    return 'strava'
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
