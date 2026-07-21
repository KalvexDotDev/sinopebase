/**
 * Gitlab OAuth2 provider (stub).
 *
 * Port of github.com/pocketbase/pocketbase/tree/master/tools/auth/gitlab.go
 * Layer 1 -- depends on BaseProvider.
 *
 * TODO: Complete the user field mapping implementation.
 * The OAuth2 flow works (auth URL, token exchange, refresh),
 * but FetchUser returns an empty AuthUser skeleton.
 *
 * Endpoints:
 *   - Auth:  https://gitlab.com/oauth/authorize
 *   - Token: https://gitlab.com/oauth/token
 *   - User:  https://gitlab.com/api/v4/user
 *
 * Default scopes: read_user
 */

import { BaseProvider } from '~/tools/auth/base_provider.ts'
// import type { AuthUser } from '~/tools/auth/auth.ts'

/**
 * GitlabProvider implements OAuth2 authentication via Gitlab.
 *
 * TODO: Implement MapUser() with the correct field mappings from
 *       the https://gitlab.com/api/v4/user response.
 *
 * @example
 * 
 */
export class GitlabProvider extends BaseProvider {
  constructor(clientId: string, clientSecret: string, redirectUrl: string) {
    super(
      clientId,
      clientSecret,
      redirectUrl,
      'https://gitlab.com/oauth/authorize',
      'https://gitlab.com/oauth/token',
      'https://gitlab.com/api/v4/user',
      ['read_user'],
    )
  }

  override DisplayName(): string {
    return 'gitlab'
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
