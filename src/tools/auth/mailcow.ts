/**
 * Mailcow OAuth2 provider (stub).
 *
 * Port of github.com/pocketbase/pocketbase/tree/master/tools/auth/mailcow.go
 * Layer 1 -- depends on BaseProvider.
 *
 * TODO: Complete the user field mapping implementation.
 * The OAuth2 flow works (auth URL, token exchange, refresh),
 * but FetchUser returns an empty AuthUser skeleton.
 *
 * NOTE: Mailcow is typically self-hosted. Update the endpoint URLs to
 * match your Mailcow server address.
 *
 * Endpoints:
 *   - Auth:  https://YOUR-SERVER/oauth/authorize
 *   - Token: https://YOUR-SERVER/oauth/token
 *   - User:  https://YOUR-SERVER/api/v1/user
 *
 * Default scopes: profile
 */

import { BaseProvider } from '~/tools/auth/base_provider.ts'
// import type { AuthUser } from '~/tools/auth/auth.ts'

/**
 * MailcowProvider implements OAuth2 authentication via Mailcow.
 *
 * TODO: Implement MapUser() with the correct field mappings from
 *       the https://YOUR-SERVER/api/v1/user response.
 *
 * @example
 * 
 */
export class MailcowProvider extends BaseProvider {
  constructor(clientId: string, clientSecret: string, redirectUrl: string) {
    super(
      clientId,
      clientSecret,
      redirectUrl,
      'https://YOUR-SERVER/oauth/authorize',
      'https://YOUR-SERVER/oauth/token',
      'https://YOUR-SERVER/api/v1/user',
      ['profile'],
    )
  }

  override DisplayName(): string {
    return 'mailcow'
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
