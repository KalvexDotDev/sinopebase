/**
 * Twitter OAuth2 provider (stub).
 *
 * Port of github.com/pocketbase/pocketbase/tree/master/tools/auth/twitter.go
 * Layer 1 -- depends on BaseProvider.
 *
 * TODO: Complete the user field mapping implementation.
 * The OAuth2 flow works (auth URL, token exchange, refresh),
 * but FetchUser returns an empty AuthUser skeleton.
 *
 * Endpoints:
 *   - Auth:  https://twitter.com/i/oauth2/authorize
 *   - Token: https://api.twitter.com/2/oauth2/token
 *   - User:  https://api.twitter.com/2/users/me
 *
 * Default scopes: tweet.read users.read
 */

import { BaseProvider } from '~/tools/auth/base_provider.ts'
// import type { AuthUser } from '~/tools/auth/auth.ts'

/**
 * TwitterProvider implements OAuth2 authentication via Twitter.
 *
 * TODO: Implement MapUser() with the correct field mappings from
 *       the https://api.twitter.com/2/users/me response.
 *
 * @example
 *
 */
export class TwitterProvider extends BaseProvider {
  constructor(clientId: string, clientSecret: string, redirectUrl: string) {
    super(
      clientId,
      clientSecret,
      redirectUrl,
      'https://twitter.com/i/oauth2/authorize',
      'https://api.twitter.com/2/oauth2/token',
      'https://api.twitter.com/2/users/me',
      ['tweet.read', 'users.read'],
    )
  }

  override DisplayName(): string {
    return 'twitter'
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
