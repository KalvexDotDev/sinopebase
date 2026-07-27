/**
 * Gitea OAuth2 provider (stub).
 *
 * Port of github.com/pocketbase/pocketbase/tree/master/tools/auth/gitea.go
 * Layer 1 -- depends on BaseProvider.
 *
 * TODO: Complete the user field mapping implementation.
 * The OAuth2 flow works (auth URL, token exchange, refresh),
 * but FetchUser returns an empty AuthUser skeleton.
 *
 * Endpoints:
 *   - Auth:  https://gitea.com/login/oauth/authorize
 *   - Token: https://gitea.com/login/oauth/access_token
 *   - User:  https://gitea.com/api/v1/user
 *
 * Default scopes: read:user
 */

import { BaseProvider } from '~/tools/auth/base_provider.ts'
// import type { AuthUser } from '~/tools/auth/auth.ts'

/**
 * GiteaProvider implements OAuth2 authentication via Gitea.
 *
 * TODO: Implement MapUser() with the correct field mappings from
 *       the https://gitea.com/api/v1/user response.
 *
 * @example
 *
 */
export class GiteaProvider extends BaseProvider {
  constructor(clientId: string, clientSecret: string, redirectUrl: string) {
    super(
      clientId,
      clientSecret,
      redirectUrl,
      'https://gitea.com/login/oauth/authorize',
      'https://gitea.com/login/oauth/access_token',
      'https://gitea.com/api/v1/user',
      ['read:user'],
    )
  }

  override DisplayName(): string {
    return 'gitea'
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
