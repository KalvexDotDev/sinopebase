/**
 * Instagram OAuth2 provider (stub).
 *
 * Port of github.com/pocketbase/pocketbase/tree/master/tools/auth/instagram.go
 * Layer 1 -- depends on BaseProvider.
 *
 * TODO: Complete the user field mapping implementation.
 * The OAuth2 flow works (auth URL, token exchange, refresh),
 * but FetchUser returns an empty AuthUser skeleton.
 *
 * Endpoints:
 *   - Auth:  https://api.instagram.com/oauth/authorize
 *   - Token: https://api.instagram.com/oauth/access_token
 *   - User:  https://graph.instagram.com/me?fields=id,username,name
 *
 * Default scopes: user_profile user_media
 */

import { BaseProvider } from '~/tools/auth/base_provider.ts'
// import type { AuthUser } from '~/tools/auth/auth.ts'

/**
 * InstagramProvider implements OAuth2 authentication via Instagram.
 *
 * TODO: Implement MapUser() with the correct field mappings from
 *       the https://graph.instagram.com/me?fields=id,username,name response.
 *
 * @example
 * 
 */
export class InstagramProvider extends BaseProvider {
  constructor(clientId: string, clientSecret: string, redirectUrl: string) {
    super(
      clientId,
      clientSecret,
      redirectUrl,
      'https://api.instagram.com/oauth/authorize',
      'https://api.instagram.com/oauth/access_token',
      'https://graph.instagram.com/me?fields=id,username,name',
      ['user_profile', 'user_media'],
    )
  }

  override DisplayName(): string {
    return 'instagram'
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
