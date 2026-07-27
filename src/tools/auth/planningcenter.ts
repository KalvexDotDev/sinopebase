/**
 * Planningcenter OAuth2 provider (stub).
 *
 * Port of github.com/pocketbase/pocketbase/tree/master/tools/auth/planningcenter.go
 * Layer 1 -- depends on BaseProvider.
 *
 * TODO: Complete the user field mapping implementation.
 * The OAuth2 flow works (auth URL, token exchange, refresh),
 * but FetchUser returns an empty AuthUser skeleton.
 *
 * Endpoints:
 *   - Auth:  https://api.planningcenteronline.com/oauth/authorize
 *   - Token: https://api.planningcenteronline.com/oauth/token
 *   - User:  https://api.planningcenteronline.com/people/v2/me
 *
 * Default scopes: none
 */

import { BaseProvider } from '~/tools/auth/base_provider.ts'
// import type { AuthUser } from '~/tools/auth/auth.ts'

/**
 * PlanningcenterProvider implements OAuth2 authentication via Planningcenter.
 *
 * TODO: Implement MapUser() with the correct field mappings from
 *       the https://api.planningcenteronline.com/people/v2/me response.
 *
 * @example
 *
 */
export class PlanningcenterProvider extends BaseProvider {
  constructor(clientId: string, clientSecret: string, redirectUrl: string) {
    super(
      clientId,
      clientSecret,
      redirectUrl,
      'https://api.planningcenteronline.com/oauth/authorize',
      'https://api.planningcenteronline.com/oauth/token',
      'https://api.planningcenteronline.com/people/v2/me',
      [],
    )
  }

  override DisplayName(): string {
    return 'planningcenter'
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
