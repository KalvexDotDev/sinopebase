/**
 * Google OAuth2 provider.
 *
 * Port of github.com/pocketbase/pocketbase/tree/master/tools/auth/google.go
 * Layer 1 -- depends on BaseProvider.
 */

import { BaseProvider } from '~/tools/auth/base_provider.ts'
import type { AuthUser } from '~/tools/auth/auth.ts'

/**
 * GoogleProvider implements OAuth2 authentication via Google's APIs.
 *
 * Uses the Google OAuth 2.0 endpoint for authorization and the
 * Google UserInfo API (v3) for fetching user profile data.
 *
 * Endpoints:
 *   - Auth:  https://accounts.google.com/o/oauth2/auth
 *   - Token: https://oauth2.googleapis.com/token
 *   - User:  https://www.googleapis.com/oauth2/v3/userinfo
 *
 * Default scopes: email, profile
 */
export class GoogleProvider extends BaseProvider {
  constructor(clientId: string, clientSecret: string, redirectUrl: string) {
    super(
      clientId,
      clientSecret,
      redirectUrl,
      'https://accounts.google.com/o/oauth2/auth',
      'https://oauth2.googleapis.com/token',
      'https://www.googleapis.com/oauth2/v3/userinfo',
      ['email', 'profile'],
    )
  }

  override DisplayName(): string {
    return 'google'
  }

  override MapUser(rawUser: unknown): AuthUser {
    const data = rawUser as Record<string, unknown>
    return {
      Id: (data.sub as string) ?? '',
      Name: (data.name as string) ?? '',
      Username: (data.email as string) ?? '',
      Email: (data.email as string) ?? '',
      AvatarUrl: (data.picture as string) ?? '',
      RawUser: rawUser,
    }
  }
}
