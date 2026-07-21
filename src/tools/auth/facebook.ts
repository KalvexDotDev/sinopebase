/**
 * Facebook OAuth2 provider (stub).
 *
 * Port of github.com/pocketbase/pocketbase/tree/master/tools/auth/facebook.go
 * Layer 1 -- depends on BaseProvider.
 *
 * TODO: Complete the user field mapping implementation.
 * The OAuth2 flow works (auth URL, token exchange, refresh),
 * but FetchUser returns an empty AuthUser skeleton.
 *
 * Endpoints:
 *   - Auth:  https://www.facebook.com/v19.0/dialog/oauth
 *   - Token: https://graph.facebook.com/v19.0/oauth/access_token
 *   - User:  https://graph.facebook.com/v19.0/me?fields=id,name,email,picture
 *
 * Default scopes: email public_profile
 */

import { BaseProvider } from '~/tools/auth/base_provider.ts'
// import type { AuthUser } from '~/tools/auth/auth.ts'

/**
 * FacebookProvider implements OAuth2 authentication via Facebook.
 *
 * TODO: Implement MapUser() with the correct field mappings from
 *       the https://graph.facebook.com/v19.0/me?fields=id,name,email,picture response.
 *
 * @example
 * 
 */
export class FacebookProvider extends BaseProvider {
  constructor(clientId: string, clientSecret: string, redirectUrl: string) {
    super(
      clientId,
      clientSecret,
      redirectUrl,
      'https://www.facebook.com/v19.0/dialog/oauth',
      'https://graph.facebook.com/v19.0/oauth/access_token',
      'https://graph.facebook.com/v19.0/me?fields=id,name,email,picture',
      ['email', 'public_profile'],
    )
  }

  override DisplayName(): string {
    return 'facebook'
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
