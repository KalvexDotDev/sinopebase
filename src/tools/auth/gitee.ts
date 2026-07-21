/**
 * Gitee OAuth2 provider (stub).
 *
 * Port of github.com/pocketbase/pocketbase/tree/master/tools/auth/gitee.go
 * Layer 1 -- depends on BaseProvider.
 *
 * TODO: Complete the user field mapping implementation.
 * The OAuth2 flow works (auth URL, token exchange, refresh),
 * but FetchUser returns an empty AuthUser skeleton.
 *
 * Endpoints:
 *   - Auth:  https://gitee.com/oauth/authorize
 *   - Token: https://gitee.com/oauth/token
 *   - User:  https://gitee.com/api/v5/user
 *
 * Default scopes: user_info
 */

import { BaseProvider } from '~/tools/auth/base_provider.ts'
// import type { AuthUser } from '~/tools/auth/auth.ts'

/**
 * GiteeProvider implements OAuth2 authentication via Gitee.
 *
 * TODO: Implement MapUser() with the correct field mappings from
 *       the https://gitee.com/api/v5/user response.
 *
 * @example
 * 
 */
export class GiteeProvider extends BaseProvider {
  constructor(clientId: string, clientSecret: string, redirectUrl: string) {
    super(
      clientId,
      clientSecret,
      redirectUrl,
      'https://gitee.com/oauth/authorize',
      'https://gitee.com/oauth/token',
      'https://gitee.com/api/v5/user',
      ['user_info'],
    )
  }

  override DisplayName(): string {
    return 'gitee'
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
