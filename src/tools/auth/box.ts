/**
 * Box OAuth2 provider (stub).
 *
 * Port of github.com/pocketbase/pocketbase/tree/master/tools/auth/box.go
 * Layer 1 -- depends on BaseProvider.
 *
 * TODO: Complete the user field mapping implementation.
 * The OAuth2 flow works (auth URL, token exchange, refresh),
 * but FetchUser returns an empty AuthUser skeleton.
 *
 * Endpoints:
 *   - Auth:  https://account.box.com/api/oauth2/authorize
 *   - Token: https://api.box.com/oauth2/token
 *   - User:  https://api.box.com/2.0/users/me
 *
 * Default scopes: none
 */

import { BaseProvider } from '~/tools/auth/base_provider.ts'
// import type { AuthUser } from '~/tools/auth/auth.ts'

/**
 * BoxProvider implements OAuth2 authentication via Box.
 *
 * TODO: Implement MapUser() with the correct field mappings from
 *       the https://api.box.com/2.0/users/me response.
 *
 * @example
 *
 */
export class BoxProvider extends BaseProvider {
  constructor(clientId: string, clientSecret: string, redirectUrl: string) {
    super(
      clientId,
      clientSecret,
      redirectUrl,
      'https://account.box.com/api/oauth2/authorize',
      'https://api.box.com/oauth2/token',
      'https://api.box.com/2.0/users/me',
      [],
    )
  }

  override DisplayName(): string {
    return 'box'
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
