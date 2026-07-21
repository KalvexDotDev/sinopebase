/**
 * Wakatime OAuth2 provider (stub).
 *
 * Port of github.com/pocketbase/pocketbase/tree/master/tools/auth/wakatime.go
 * Layer 1 -- depends on BaseProvider.
 *
 * TODO: Complete the user field mapping implementation.
 * The OAuth2 flow works (auth URL, token exchange, refresh),
 * but FetchUser returns an empty AuthUser skeleton.
 *
 * Endpoints:
 *   - Auth:  https://wakatime.com/oauth/authorize
 *   - Token: https://wakatime.com/oauth/token
 *   - User:  https://wakatime.com/api/v1/users/current
 *
 * Default scopes: email read_stats
 */

import { BaseProvider } from '~/tools/auth/base_provider.ts'
// import type { AuthUser } from '~/tools/auth/auth.ts'

/**
 * WakatimeProvider implements OAuth2 authentication via Wakatime.
 *
 * TODO: Implement MapUser() with the correct field mappings from
 *       the https://wakatime.com/api/v1/users/current response.
 *
 * @example
 * 
 */
export class WakatimeProvider extends BaseProvider {
  constructor(clientId: string, clientSecret: string, redirectUrl: string) {
    super(
      clientId,
      clientSecret,
      redirectUrl,
      'https://wakatime.com/oauth/authorize',
      'https://wakatime.com/oauth/token',
      'https://wakatime.com/api/v1/users/current',
      ['email', 'read_stats'],
    )
  }

  override DisplayName(): string {
    return 'wakatime'
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
