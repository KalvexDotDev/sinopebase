/**
 * Lark OAuth2 provider (stub).
 *
 * Port of github.com/pocketbase/pocketbase/tree/master/tools/auth/lark.go
 * Layer 1 -- depends on BaseProvider.
 *
 * TODO: Complete the user field mapping implementation.
 * The OAuth2 flow works (auth URL, token exchange, refresh),
 * but FetchUser returns an empty AuthUser skeleton.
 *
 * Endpoints:
 *   - Auth:  https://open.feishu.cn/open-apis/authen/v1/index
 *   - Token: https://open.feishu.cn/open-apis/authen/v1/access_token
 *   - User:  https://open.feishu.cn/open-apis/authen/v1/user_info
 *
 * Default scopes: none
 */

import { BaseProvider } from '~/tools/auth/base_provider.ts'
// import type { AuthUser } from '~/tools/auth/auth.ts'

/**
 * LarkProvider implements OAuth2 authentication via Lark.
 *
 * TODO: Implement MapUser() with the correct field mappings from
 *       the https://open.feishu.cn/open-apis/authen/v1/user_info response.
 *
 * @example
 *
 */
export class LarkProvider extends BaseProvider {
  constructor(clientId: string, clientSecret: string, redirectUrl: string) {
    super(
      clientId,
      clientSecret,
      redirectUrl,
      'https://open.feishu.cn/open-apis/authen/v1/index',
      'https://open.feishu.cn/open-apis/authen/v1/access_token',
      'https://open.feishu.cn/open-apis/authen/v1/user_info',
      [],
    )
  }

  override DisplayName(): string {
    return 'lark'
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
