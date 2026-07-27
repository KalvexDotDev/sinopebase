/**
 * Discord OAuth2 provider (stub).
 *
 * Port of github.com/pocketbase/pocketbase/tree/master/tools/auth/discord.go
 * Layer 1 -- depends on BaseProvider.
 *
 * TODO: Complete the user field mapping implementation.
 * The OAuth2 flow works (auth URL, token exchange, refresh),
 * but FetchUser returns an empty AuthUser skeleton.
 *
 * Endpoints:
 *   - Auth:  https://discord.com/api/oauth2/authorize
 *   - Token: https://discord.com/api/oauth2/token
 *   - User:  https://discord.com/api/users/@me
 *
 * Default scopes: identify email guilds
 */

import { BaseProvider } from '~/tools/auth/base_provider.ts'
// import type { AuthUser } from '~/tools/auth/auth.ts'

/**
 * DiscordProvider implements OAuth2 authentication via Discord.
 *
 * TODO: Implement MapUser() with the correct field mappings from
 *       the https://discord.com/api/users/@me response.
 *
 * @example
 *
 */
export class DiscordProvider extends BaseProvider {
  constructor(clientId: string, clientSecret: string, redirectUrl: string) {
    super(
      clientId,
      clientSecret,
      redirectUrl,
      'https://discord.com/api/oauth2/authorize',
      'https://discord.com/api/oauth2/token',
      'https://discord.com/api/users/@me',
      ['identify', 'email', 'guilds'],
    )
  }

  override DisplayName(): string {
    return 'discord'
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
