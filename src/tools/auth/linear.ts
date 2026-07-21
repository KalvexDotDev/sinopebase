/**
 * Linear OAuth2 provider (stub).
 *
 * Port of github.com/pocketbase/pocketbase/tree/master/tools/auth/linear.go
 * Layer 1 -- depends on BaseProvider.
 *
 * TODO: Complete the user field mapping implementation.
 * The OAuth2 flow works (auth URL, token exchange, refresh),
 * but FetchUser returns an empty AuthUser skeleton.
 *
 * Endpoints:
 *   - Auth:  https://linear.app/oauth/authorize
 *   - Token: https://api.linear.app/oauth/token
 *   - User:  https://api.linear.app/graphql
 *
 * Default scopes: read write
 */

import { BaseProvider } from '~/tools/auth/base_provider.ts'
// import type { AuthUser } from '~/tools/auth/auth.ts'

/**
 * LinearProvider implements OAuth2 authentication via Linear.
 *
 * TODO: Implement MapUser() with the correct field mappings from
 *       the https://api.linear.app/graphql response.
 *
 * @example
 * 
 */
export class LinearProvider extends BaseProvider {
  constructor(clientId: string, clientSecret: string, redirectUrl: string) {
    super(
      clientId,
      clientSecret,
      redirectUrl,
      'https://linear.app/oauth/authorize',
      'https://api.linear.app/oauth/token',
      'https://api.linear.app/graphql',
      ['read', 'write'],
    )
  }

  override DisplayName(): string {
    return 'linear'
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
