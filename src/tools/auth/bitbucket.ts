/**
 * Bitbucket OAuth2 provider (stub).
 *
 * Port of github.com/pocketbase/pocketbase/tree/master/tools/auth/bitbucket.go
 * Layer 1 -- depends on BaseProvider.
 *
 * TODO: Complete the user field mapping implementation.
 * The OAuth2 flow works (auth URL, token exchange, refresh),
 * but FetchUser returns an empty AuthUser skeleton.
 *
 * Endpoints:
 *   - Auth:  https://bitbucket.org/site/oauth2/authorize
 *   - Token: https://bitbucket.org/site/oauth2/access_token
 *   - User:  https://api.bitbucket.org/2.0/user
 *
 * Default scopes: account
 */

import { BaseProvider } from '~/tools/auth/base_provider.ts'
// import type { AuthUser } from '~/tools/auth/auth.ts'

/**
 * BitbucketProvider implements OAuth2 authentication via Bitbucket.
 *
 * TODO: Implement MapUser() with the correct field mappings from
 *       the https://api.bitbucket.org/2.0/user response.
 *
 * @example
 *
 */
export class BitbucketProvider extends BaseProvider {
  constructor(clientId: string, clientSecret: string, redirectUrl: string) {
    super(
      clientId,
      clientSecret,
      redirectUrl,
      'https://bitbucket.org/site/oauth2/authorize',
      'https://bitbucket.org/site/oauth2/access_token',
      'https://api.bitbucket.org/2.0/user',
      ['account'],
    )
  }

  override DisplayName(): string {
    return 'bitbucket'
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
