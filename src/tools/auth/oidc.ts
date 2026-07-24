/**
 * Generic OpenID Connect (OIDC) provider.
 *
 * Port of github.com/pocketbase/pocketbase/tree/master/tools/auth/oidc.go
 * Layer 1 -- depends on BaseProvider.
 *
 * Unlike standard OAuth2 providers, an OIDC provider auto-discovers its
 * endpoints by fetching the .well-known/openid-configuration document
 * provided by the issuer.  This allows any standards-compliant OIDC
 * server (Keycloak, Okta, Dex, Auth0, etc.) to be used without
 * hard-coding the endpoint URLs.
 */

import { BaseProvider, type TokenResponse } from '~/tools/auth/base_provider.ts'
import type { AuthUser, HttpClient } from '~/tools/auth/auth.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * OIDCConfiguration represents the relevant fields of an OpenID Connect
 * discovery document.
 */
interface OIDCConfiguration {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  userinfo_endpoint: string
  jwks_uri?: string
  scopes_supported?: string[]
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// OIDCProvider
// ---------------------------------------------------------------------------

/**
 * OIDCProvider implements generic OIDC authentication.
 *
 * It fetches the OpenID Connect discovery document from the provider's
 * `issuer` URL (e.g. https://accounts.example.com) and uses the
 * auto-discovered endpoints for the OAuth2 flow.
 *
 * Usage:
 * ```ts
 * const provider = new OIDCProvider(
 *   'my-client-id',
 *   'my-client-secret',
 *   'https://myapp.com/auth/callback',
 *   'https://accounts.example.com',
 *   ['openid', 'profile', 'email'],
 * )
 *
 * // First call triggers discovery; subsequent calls use cached endpoints
 * const url = await provider.BuildAuthUrl('some-state')
 * ```
 */
export class OIDCProvider extends BaseProvider {
  private issuer: string
  private discovered: OIDCConfiguration | null = null
  private scopes: string[]

  constructor(
    clientId: string,
    clientSecret: string,
    redirectUrl: string,
    issuer: string,
    scopes: string[] = ['openid', 'profile', 'email'],
  ) {
    // URLs are empty initially -- they get populated by Discover()
    super(clientId, clientSecret, redirectUrl, '', '', '', scopes)
    this.issuer = issuer.replace(/\/$/, '')
    this.scopes = scopes
  }

  override DisplayName(): string {
    return 'oidc'
  }

  // -----------------------------------------------------------------------
  // Discovery
  // -----------------------------------------------------------------------

  /**
   * Discover fetches the OpenID Connect discovery document and populates
   * the AuthUrl, TokenUrl, and UserInfoUrl fields.
   *
   * Called automatically by BuildAuthUrl, ExchangeCode, and FetchUser
   * if not yet discovered.  Can also be called explicitly to fail fast.
   */
  async Discover(): Promise<void> {
    if (this.discovered) {
      return
    }

    const discoveryUrl = `${this.issuer}/.well-known/openid-configuration`
    const response = await fetch(discoveryUrl)

    if (!response.ok) {
      throw new Error(
        `OIDC discovery failed for ${this.issuer}: ${response.status} ${response.statusText}`,
      )
    }

    const config = (await response.json()) as OIDCConfiguration

    if (!config.authorization_endpoint) {
      throw new Error(
        `OIDC discovery missing authorization_endpoint for issuer ${this.issuer}`,
      )
    }
    if (!config.token_endpoint) {
      throw new Error(
        `OIDC discovery missing token_endpoint for issuer ${this.issuer}`,
      )
    }

    this.AuthUrl = config.authorization_endpoint
    this.TokenUrl = config.token_endpoint
    this.UserInfoUrl = config.userinfo_endpoint ?? ''
    this.Scopes = this.scopes

    this.discovered = config
  }

  /**
   * ResetDiscovery clears the cached discovery document, forcing a fresh
   * fetch on the next operation.
   */
  ResetDiscovery(): void {
    this.discovered = null
  }

  // -----------------------------------------------------------------------
  // Overrides that trigger discovery
  // -----------------------------------------------------------------------

  override async BuildAuthUrl(
    state: string,
    opts?: {
      Scope?: string[]
      CodeChallenge?: string
      CodeChallengeMethod?: string
    },
  ): Promise<string> {
    await this.Discover()
    return await super.BuildAuthUrl(state, opts)
  }

  override async ExchangeCode(
    code: string,
    codeVerifier?: string,
  ): Promise<TokenResponse> {
    await this.Discover()
    return super.ExchangeCode(code, codeVerifier)
  }

  override async FetchUser(
    token: string,
    client?: HttpClient,
  ): Promise<AuthUser> {
    await this.Discover()
    return super.FetchUser(token, client)
  }

  // -----------------------------------------------------------------------
  // User mapping
  // -----------------------------------------------------------------------

  override MapUser(rawUser: unknown): AuthUser {
    const data = rawUser as Record<string, unknown>
    return {
      Id: (data['sub'] as string) ?? '',
      Name: (data['name'] as string) ?? '',
      Username: (data['preferred_username'] as string) ?? (data['email'] as string) ?? '',
      Email: (data['email'] as string) ?? '',
      AvatarUrl: (data['picture'] as string) ?? '',
      RawUser: rawUser,
    }
  }

}
