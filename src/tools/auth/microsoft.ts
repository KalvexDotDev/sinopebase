/**
 * Microsoft OAuth2 provider (Azure AD / Microsoft Graph).
 *
 * Port of github.com/pocketbase/pocketbase/tree/master/tools/auth/microsoft.go
 * Layer 1 -- depends on BaseProvider.
 *
 * Supports both multi-tenant ("common") and single-tenant Azure AD
 * applications via the `tenant` constructor parameter.
 *
 * Endpoints:
 *   - Auth:  https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize
 *   - Token: https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
 *   - User:  https://graph.microsoft.com/v1.0/me
 *
 * Default scopes: User.Read, openid, email, profile
 */

import type { AuthUser } from '~/tools/auth/auth.ts'
import { BaseProvider } from '~/tools/auth/base_provider.ts'

/**
 * MicrosoftProvider implements OAuth2 authentication via Microsoft
 * Identity Platform (Azure AD v2.0).
 *
 * @example
 * ```ts
 * // Multi-tenant (any Microsoft account)
 * const provider = new MicrosoftProvider(
 *   'client-id', 'client-secret', 'https://app.com/auth/callback',
 * )
 *
 * // Single-tenant
 * const provider = new MicrosoftProvider(
 *   'client-id', 'client-secret', 'https://app.com/auth/callback',
 *   'your-tenant-id',
 * )
 * ```
 */
export class MicrosoftProvider extends BaseProvider {
  constructor(
    clientId: string,
    clientSecret: string,
    redirectUrl: string,
    tenant: string = 'common',
  ) {
    super(
      clientId,
      clientSecret,
      redirectUrl,
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      'https://graph.microsoft.com/v1.0/me',
      ['User.Read', 'openid', 'email', 'profile'],
    )
  }

  override DisplayName(): string {
    return 'microsoft'
  }

  override MapUser(rawUser: unknown): AuthUser {
    const data = rawUser as Record<string, unknown>
    return {
      Id: (data.id as string) ?? '',
      Name: (data.displayName as string) ?? '',
      Username: (data.userPrincipalName as string) ?? (data.mail as string) ?? '',
      Email: (data.mail as string) ?? (data.userPrincipalName as string) ?? '',
      AvatarUrl: '',
      RawUser: rawUser,
    }
  }
}
