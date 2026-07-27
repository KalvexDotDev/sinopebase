/**
 * Kakao OAuth2 provider (stub).
 *
 * Port of github.com/pocketbase/pocketbase/tree/master/tools/auth/kakao.go
 * Layer 1 -- depends on BaseProvider.
 *
 * TODO: Complete the user field mapping implementation.
 * The OAuth2 flow works (auth URL, token exchange, refresh),
 * but FetchUser returns an empty AuthUser skeleton.
 *
 * Endpoints:
 *   - Auth:  https://kauth.kakao.com/oauth/authorize
 *   - Token: https://kauth.kakao.com/oauth/token
 *   - User:  https://kapi.kakao.com/v2/user/me
 *
 * Default scopes: talk_message profile
 */

import { BaseProvider } from '~/tools/auth/base_provider.ts'
// import type { AuthUser } from '~/tools/auth/auth.ts'

/**
 * KakaoProvider implements OAuth2 authentication via Kakao.
 *
 * TODO: Implement MapUser() with the correct field mappings from
 *       the https://kapi.kakao.com/v2/user/me response.
 *
 * @example
 *
 */
export class KakaoProvider extends BaseProvider {
  constructor(clientId: string, clientSecret: string, redirectUrl: string) {
    super(
      clientId,
      clientSecret,
      redirectUrl,
      'https://kauth.kakao.com/oauth/authorize',
      'https://kauth.kakao.com/oauth/token',
      'https://kapi.kakao.com/v2/user/me',
      ['talk_message', 'profile'],
    )
  }

  override DisplayName(): string {
    return 'kakao'
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
