/**
 * Livechat OAuth2 provider (stub).
 *
 * Port of github.com/pocketbase/pocketbase/tree/master/tools/auth/livechat.go
 * Layer 1 -- depends on BaseProvider.
 *
 * TODO: Complete the user field mapping implementation.
 * The OAuth2 flow works (auth URL, token exchange, refresh),
 * but FetchUser returns an empty AuthUser skeleton.
 *
 * Endpoints:
 *   - Auth:  https://accounts.livechat.com/oauth/authorize
 *   - Token: https://accounts.livechat.com/oauth/token
 *   - User:  https://accounts.livechat.com/v2/user_info
 *
 * Default scopes: none
 */

import { BaseProvider } from '~/tools/auth/base_provider.ts'
// import type { AuthUser } from '~/tools/auth/auth.ts'

/**
 * LivechatProvider implements OAuth2 authentication via Livechat.
 *
 * TODO: Implement MapUser() with the correct field mappings from
 *       the https://accounts.livechat.com/v2/user_info response.
 *
 * @example
 * 
 */
export class LivechatProvider extends BaseProvider {
  constructor(clientId: string, clientSecret: string, redirectUrl: string) {
    super(
      clientId,
      clientSecret,
      redirectUrl,
      'https://accounts.livechat.com/oauth/authorize',
      'https://accounts.livechat.com/oauth/token',
      'https://accounts.livechat.com/v2/user_info',
      [],
    )
  }

  override DisplayName(): string {
    return 'livechat'
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
