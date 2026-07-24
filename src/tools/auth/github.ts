/**
 * GitHub OAuth2 provider.
 *
 * Port of github.com/pocketbase/pocketbase/tree/master/tools/auth/github.go
 * Layer 1 -- depends on BaseProvider.
 */

import { BaseProvider } from '~/tools/auth/base_provider.ts'
import type { AuthUser, HttpClient } from '~/tools/auth/auth.ts'

/**
 * GitHubProvider implements OAuth2 authentication via GitHub.
 *
 * GitHub requires a separate call to /user/emails to get the user's
 * primary email address (the /user endpoint does not include it
 * when the user keeps their email private).
 *
 * Endpoints:
 *   - Auth:  https://github.com/login/oauth/authorize
 *   - Token: https://github.com/login/oauth/access_token
 *   - User:  https://api.github.com/user
 *
 * Default scopes: read:user, user:email
 */
export class GitHubProvider extends BaseProvider {
  constructor(clientId: string, clientSecret: string, redirectUrl: string) {
    super(
      clientId,
      clientSecret,
      redirectUrl,
      'https://github.com/login/oauth/authorize',
      'https://github.com/login/oauth/access_token',
      'https://api.github.com/user',
      ['read:user', 'user:email'],
    )
  }

  override DisplayName(): string {
    return 'github'
  }

  override async FetchUser(
    token: string,
    client?: HttpClient,
  ): Promise<AuthUser> {
    const doFetch = client ?? fetch

    // -------------------------------------------------------------------
    // 1. Fetch the primary user profile
    // -------------------------------------------------------------------
    const userResponse = await doFetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!userResponse.ok) {
      throw new Error(
        `GitHub user fetch failed: ${userResponse.status} ${userResponse.statusText}`,
      )
    }

    const userData = (await userResponse.json()) as Record<string, unknown>

    // -------------------------------------------------------------------
    // 2. Fetch email addresses to find the primary email
    //    (GitHub hides emails in /user when they're set to private)
    // -------------------------------------------------------------------
    let email = ''

    try {
      const emailsResponse = await doFetch(
        'https://api.github.com/user/emails',
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      )

      if (emailsResponse.ok) {
        const emails =
          (await emailsResponse.json()) as Array<Record<string, unknown>>
        const primary = emails.find((e) => e['primary'] === true)
        if (primary) {
          email = (primary['email'] as string) ?? ''
        }
      }
    } catch {
      // Non-fatal -- user will still have empty email
    }

    // -------------------------------------------------------------------
    // 3. Map to AuthUser
    // -------------------------------------------------------------------
    return {
      Id: String(userData['id'] ?? ''),
      Name: (userData['name'] as string) ?? (userData['login'] as string) ?? '',
      Username: (userData['login'] as string) ?? '',
      Email: email,
      AvatarUrl: (userData['avatar_url'] as string) ?? '',
      RawUser: userData,
    }
  }
}
