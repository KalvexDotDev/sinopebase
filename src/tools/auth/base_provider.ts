/**
 * BaseProvider implements common OAuth2 HTTP logic shared by all providers.
 *
 * Port of github.com/pocketbase/pocketbase/tree/master/tools/auth/base_provider.go
 * Layer 1 -- depends on auth.ts for the Provider interface.
 */

import type { Provider, AuthUser, HttpClient } from '~/tools/auth/auth.ts'

// ---------------------------------------------------------------------------
// TokenResponse
// ---------------------------------------------------------------------------

/**
 * TokenResponse holds the OAuth2 token exchange result.
 */
export interface TokenResponse {
  /** AccessToken is the access token returned by the provider. */
  AccessToken: string
  /** RefreshToken is the optional refresh token. */
  RefreshToken: string
  /** ExpiresIn is the lifetime of the access token in seconds. */
  ExpiresIn: number
  /** Raw holds the full, unmodified token response from the provider. */
  Raw: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// BaseProvider
// ---------------------------------------------------------------------------

/**
 * BaseProvider provides common OAuth2 logic that can be embedded / extended
 * by specific providers.
 *
 * Handles:
 *   - Building the authorization URL (with PKCE support)
 *   - Exchanging an authorization code for tokens
 *   - Refreshing tokens
 *   - Fetching raw user info
 *   - Mapping user info to AuthUser
 */
export class BaseProvider implements Provider {
  ClientId: string
  ClientSecret: string
  RedirectUrl: string
  AuthUrl: string
  TokenUrl: string
  UserInfoUrl: string
  Scopes: string[]

  constructor(
    clientId: string,
    clientSecret: string,
    redirectUrl: string,
    authUrl: string,
    tokenUrl: string,
    userInfoUrl: string,
    scopes: string[] = [],
  ) {
    this.ClientId = clientId
    this.ClientSecret = clientSecret
    this.RedirectUrl = redirectUrl
    this.AuthUrl = authUrl
    this.TokenUrl = tokenUrl
    this.UserInfoUrl = userInfoUrl
    this.Scopes = scopes
  }

  // -----------------------------------------------------------------------
  // Provider interface
  // -----------------------------------------------------------------------

  /**
   * DisplayName returns the provider display name.
   * Override in subclasses.
   */
  DisplayName(): string {
    return ''
  }

  /**
   * FetchUser retrieves the authenticated user's data from the provider.
   *
   * Calls FetchRawUserInfo to get the raw response, then MapUser to convert
   * it to an AuthUser. Override either method in subclasses for
   * provider-specific behaviour.
   */
  async FetchUser(token: string, client?: HttpClient): Promise<AuthUser> {
    const rawData = await this.FetchRawUserInfo(token, client)
    return this.MapUser(rawData)
  }

  // -----------------------------------------------------------------------
  // OAuth2 flow helpers
  // -----------------------------------------------------------------------

  /**
   * BuildAuthUrl constructs the OAuth2 authorization URL.
   *
   * @param state  Opaque state value for CSRF protection.
   * @param opts   Optional overrides for scopes, PKCE challenge.
   */
  BuildAuthUrl(
    state: string,
    opts?: {
      Scope?: string[]
      CodeChallenge?: string
      CodeChallengeMethod?: string
    },
  ): string {
    const url = new URL(this.AuthUrl)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', this.ClientId)
    url.searchParams.set('redirect_uri', this.RedirectUrl)
    url.searchParams.set('state', state)

    const scopes = opts?.Scope ?? this.Scopes
    if (scopes.length > 0) {
      url.searchParams.set('scope', scopes.join(' '))
    }

    if (opts?.CodeChallenge) {
      url.searchParams.set('code_challenge', opts.CodeChallenge)
      url.searchParams.set(
        'code_challenge_method',
        opts.CodeChallengeMethod ?? 'S256',
      )
    }

    return url.toString()
  }

  /**
   * ExchangeCode exchanges an authorization code for tokens.
   *
   * @param code          The authorization code from the provider.
   * @param codeVerifier  PKCE code verifier (if PKCE was used).
   */
  async ExchangeCode(
    code: string,
    codeVerifier?: string,
  ): Promise<TokenResponse> {
    const body = new URLSearchParams()
    body.set('grant_type', 'authorization_code')
    body.set('code', code)
    body.set('redirect_uri', this.RedirectUrl)
    body.set('client_id', this.ClientId)
    body.set('client_secret', this.ClientSecret)

    if (codeVerifier) {
      body.set('code_verifier', codeVerifier)
    }

    const response = await fetch(this.TokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(
        `Token exchange failed (${response.status}): ${errorText}`,
      )
    }

    const data = (await response.json()) as Record<string, unknown>

    return {
      AccessToken: (data.access_token as string) ?? '',
      RefreshToken: (data.refresh_token as string) ?? '',
      ExpiresIn: (data.expires_in as number) ?? 0,
      Raw: data,
    }
  }

  /**
   * RefreshToken uses a refresh token to obtain a new access token.
   */
  async RefreshToken(refreshToken: string): Promise<TokenResponse> {
    const body = new URLSearchParams()
    body.set('grant_type', 'refresh_token')
    body.set('refresh_token', refreshToken)
    body.set('client_id', this.ClientId)
    body.set('client_secret', this.ClientSecret)

    const response = await fetch(this.TokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(
        `Token refresh failed (${response.status}): ${errorText}`,
      )
    }

    const data = (await response.json()) as Record<string, unknown>

    return {
      AccessToken: (data.access_token as string) ?? '',
      RefreshToken: (data.refresh_token as string) ?? '',
      ExpiresIn: (data.expires_in as number) ?? 0,
      Raw: data,
    }
  }

  // -----------------------------------------------------------------------
  // Protected helpers (overridable by subclasses)
  // -----------------------------------------------------------------------

  /**
   * FetchRawUserInfo fetches the raw user info from the provider's
   * UserInfoUrl endpoint.
   *
   * Override this if the provider requires multiple API calls or special
   * headers to assemble the user data.
   */
  protected async FetchRawUserInfo(
    token: string,
    client?: HttpClient,
  ): Promise<Record<string, unknown>> {
    const doFetch = client ?? fetch
    const response = await doFetch(this.UserInfoUrl, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!response.ok) {
      throw new Error(
        `Failed to fetch user info from ${this.UserInfoUrl}: ${response.status}`,
      )
    }

    return response.json() as Promise<Record<string, unknown>>
  }

  /**
   * MapUser converts the raw provider response into a standard AuthUser.
   *
   * Override in subclasses to extract provider-specific fields.
   * The default implementation extracts nothing but RawUser.
   */
  protected MapUser(rawUser: unknown): AuthUser {
    return {
      Id: '',
      Name: '',
      Username: '',
      Email: '',
      AvatarUrl: '',
      RawUser: rawUser,
    }
  }
}
