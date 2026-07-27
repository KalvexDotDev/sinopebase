/**
 * Yandex OAuth2 provider (stub).
 *
 * Port of github.com/pocketbase/pocketbase/tree/master/tools/auth/yandex.go
 * Layer 1 -- depends on BaseProvider.
 *
 * TODO: Complete the user field mapping implementation.
 * The OAuth2 flow works (auth URL, token exchange, refresh),
 * but FetchUser returns an empty AuthUser skeleton.
 *
 * Endpoints:
 *   - Auth:  https://oauth.yandex.ru/authorize
 *   - Token: https://oauth.yandex.ru/token
 *   - User:  https://login.yandex.ru/info
 *
 * Default scopes: login:email login:avatar
 */

import { BaseProvider } from '~/tools/auth/base_provider.ts'
// import type { AuthUser } from '~/tools/auth/auth.ts'

/**
 * YandexProvider implements OAuth2 authentication via Yandex.
 *
 * TODO: Implement MapUser() with the correct field mappings from
 *       the https://login.yandex.ru/info response.
 *
 * @example
 *
 */
export class YandexProvider extends BaseProvider {
  constructor(clientId: string, clientSecret: string, redirectUrl: string) {
    super(
      clientId,
      clientSecret,
      redirectUrl,
      'https://oauth.yandex.ru/authorize',
      'https://oauth.yandex.ru/token',
      'https://login.yandex.ru/info',
      ['login:email', 'login:avatar'],
    )
  }

  override DisplayName(): string {
    return 'yandex'
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
