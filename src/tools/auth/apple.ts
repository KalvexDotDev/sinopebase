/**
 * Apple Sign In OAuth2 provider.
 *
 * Port of github.com/pocketbase/pocketbase/tree/master/tools/auth/apple.go
 * Layer 1 -- depends on BaseProvider and JWK utilities.
 *
 * Apple uses a distinctive authentication flow:
 *   1. A JWT client secret (signed with an ES256 private key) must
 *      be generated for every token exchange / refresh.
 *   2. Apple may or may not return a `user` field in the initial
 *      authorization response (it is only returned on the very first
 *      login and MUST be sent back during the code exchange).
 *   3. The user info endpoint does not exist in the traditional sense
 *      -- profile data (name, email) comes from the ID token returned
 *      in the token response.
 *
 * Endpoints:
 *   - Auth:  https://appleid.apple.com/auth/authorize
 *   - Token: https://appleid.apple.com/auth/token
 *   - User:  (none -- data comes from the ID token)
 *
 * Required parameters (beyond client id/secret/redirect):
 *   - teamId:    Apple Developer Team ID (10-character string)
 *   - keyId:     Key ID of the private key generated in Apple Developer Portal
 *   - privateKey: The contents of the .p8 private key file (PKCS#8 format)
 */

import { SignJWT, importPKCS8 } from 'jose'
import { BaseProvider } from '~/tools/auth/base_provider.ts'
import type { AuthUser, HttpClient } from '~/tools/auth/auth.ts'

/**
 * AppleProvider implements Sign In with Apple.
 *
 * @example
 * ```ts
 * const provider = new AppleProvider(
 *   'com.example.app.client',
 *   '',                    // client_secret is generated from the private key
 *   'https://app.com/auth/callback',
 *   'ABCDEF1234',          // teamId
 *   'XYZ789',              // keyId
 *   `-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----`, // .p8 key
 * )
 * ```
 */
export class AppleProvider extends BaseProvider {
  private teamId: string
  private keyId: string
  private privateKey: string

  constructor(
    clientId: string,
    clientSecret: string,
    redirectUrl: string,
    teamId: string,
    keyId: string,
    privateKey: string,
  ) {
    // Apple has no user info endpoint -- data comes from the ID token
    super(
      clientId,
      clientSecret,
      redirectUrl,
      'https://appleid.apple.com/auth/authorize',
      'https://appleid.apple.com/auth/token',
      '', // no UserInfoUrl
      ['name', 'email'],
    )
    this.teamId = teamId
    this.keyId = keyId
    this.privateKey = privateKey
  }

  override DisplayName(): string {
    return 'apple'
  }

  // -----------------------------------------------------------------------
  // Client secret generation
  // -----------------------------------------------------------------------

  /**
   * CreateClientSecret generates a JWT client secret signed with the
   * provider's ES256 private key, as required by Apple's OAuth2 flow.
   *
   * The generated JWT is valid for 1 hour (Apple rejects tokens with
   * a longer lifetime).
   */
  async CreateClientSecret(): Promise<string> {
    const privateKey = await importPKCS8(this.privateKey, 'ES256')

    const now = Math.floor(Date.now() / 1000)
    const jwt = await new SignJWT({
      iss: this.teamId,
      iat: now,
      exp: now + 3600, // 1 hour max (Apple requirement)
      aud: 'https://appleid.apple.com',
      sub: this.ClientId,
    })
      .setProtectedHeader({ alg: 'ES256', kid: this.keyId })
      .sign(privateKey)

    return jwt
  }

  // -----------------------------------------------------------------------
  // Override code exchange to use JWT client secret
  // -----------------------------------------------------------------------

  /**
   * ExchangeCode exchanges the authorization code for tokens.
   *
   * Automatically generates a fresh client secret JWT for each exchange.
   * The optional `userPayload` should be sent if Apple returned a `user`
   * field in the initial response (first login only).
   *
   * @param code          The authorization code from Apple.
   * @param codeVerifier  PKCE code verifier (optional).
   * @param userPayload   The JSON string of the `user` field returned by
   *                      Apple on the very first login (optional).
   */
  override async ExchangeCode(
    code: string,
    codeVerifier?: string,
    userPayload?: string,
  ): Promise<{
    AccessToken: string
    RefreshToken: string
    ExpiresIn: number
    Raw: Record<string, unknown>
    IdToken?: string
  }> {
    const clientSecret = await this.CreateClientSecret()

    const body = new URLSearchParams()
    body.set('grant_type', 'authorization_code')
    body.set('code', code)
    body.set('redirect_uri', this.RedirectUrl)
    body.set('client_id', this.ClientId)
    body.set('client_secret', clientSecret)

    if (codeVerifier) {
      body.set('code_verifier', codeVerifier)
    }

    if (userPayload) {
      body.set('user', userPayload)
    }

    const response = await fetch(this.TokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(
        `Apple token exchange failed (${response.status}): ${errorText}`,
      )
    }

    const data = (await response.json()) as Record<string, unknown>

    return {
      AccessToken: (data['access_token'] as string) ?? '',
      RefreshToken: (data['refresh_token'] as string) ?? '',
      ExpiresIn: (data['expires_in'] as number) ?? 0,
      Raw: data,
      IdToken: data['id_token'] as string | undefined,
    }
  }

  /**
   * RefreshToken uses a refresh token to obtain a new access token.
   *
   * Generates a fresh client secret JWT for each refresh.
   */
  override async RefreshToken(
    refreshToken: string,
  ): Promise<{
    AccessToken: string
    RefreshToken: string
    ExpiresIn: number
    Raw: Record<string, unknown>
    IdToken?: string
  }> {
    const clientSecret = await this.CreateClientSecret()

    const body = new URLSearchParams()
    body.set('grant_type', 'refresh_token')
    body.set('refresh_token', refreshToken)
    body.set('client_id', this.ClientId)
    body.set('client_secret', clientSecret)

    const response = await fetch(this.TokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(
        `Apple token refresh failed (${response.status}): ${errorText}`,
      )
    }

    const data = (await response.json()) as Record<string, unknown>

    return {
      AccessToken: (data['access_token'] as string) ?? '',
      RefreshToken: (data['refresh_token'] as string) ?? '',
      ExpiresIn: (data['expires_in'] as number) ?? 0,
      Raw: data,
      IdToken: data['id_token'] as string | undefined,
    }
  }

  // -----------------------------------------------------------------------
  // FetchUser (decodes the ID token)
  // -----------------------------------------------------------------------

  /**
   * FetchUser decodes the ID token from a prior ExchangeCode/RefreshToken
   * call to extract user profile data.
   *
   * Apple does NOT have a user info endpoint -- all profile data is
   * embedded in the ID token (JWT).
   *
   * @param token   The access token (used to look up cached ID token).
   * @param client  Optional HTTP client (unused by Apple).
   * @param idToken The ID token from the ExchangeCode/RefreshToken response.
   *                If not provided, FetchUser will attempt to decode it
   *                from the stored token response.
   */
  override async FetchUser(
    _token: string,
    _client?: HttpClient,
    idToken?: string,
  ): Promise<AuthUser> {
    if (!idToken) {
      return {
        Id: '',
        Name: '',
        Username: '',
        Email: '',
        AvatarUrl: '',
        RawUser: null,
      }
    }

    // Decode the ID token payload (without verification -- it was
    // already verified by the token exchange / refresh)
    const parts = idToken.split('.')
    if (parts.length !== 3) {
      throw new Error('Invalid ID token format')
    }

    const payload = JSON.parse(
      Buffer.from(parts[1] ?? '', 'base64url').toString('utf-8'),
    ) as Record<string, unknown>

    return {
      Id: (payload['sub'] as string) ?? '',
      Name:
        (payload['name'] as string) ??
        (payload['email'] as string) ??
        '',
      Username: (payload['email'] as string) ?? '',
      Email: (payload['email'] as string) ?? '',
      AvatarUrl: '',
      RawUser: payload,
    }
  }
}
