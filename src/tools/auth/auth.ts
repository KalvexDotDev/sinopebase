/**
 * OAuth2 provider interfaces for PocketBase-style auth.
 *
 * Port of github.com/pocketbase/pocketbase/tree/master/tools/auth/auth.go
 * Layer 1 -- depends on Layer 0 types via ~/ alias.
 */

// ---------------------------------------------------------------------------
// AuthUser
// ---------------------------------------------------------------------------

/**
 * AuthUser represents an authenticated user returned by an OAuth2 provider.
 */
export interface AuthUser {
  /** Id is the unique identifier of the user at the provider. */
  Id: string
  /** Name is the display name of the user. */
  Name: string
  /** Username is the user's handle / login name. */
  Username: string
  /** Email is the user's email address. */
  Email: string
  /** AvatarUrl is a URL pointing to the user's profile picture. */
  AvatarUrl: string
  /** RawUser holds the full, unmodified response from the provider. */
  RawUser: unknown
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * HttpClient is a minimal fetch-compatible function.
 *
 * Matches Go's `*http.Client` -- allows passing a custom fetch wrapper
 * for testing, proxies, or adding headers.
 */
export type HttpClient = typeof fetch

/**
 * Provider is the interface that all OAuth2 providers must implement.
 *
 * Each provider knows how to return a display name and how to fetch
 * an AuthUser given an access token.
 */
export interface Provider {
  /** DisplayName returns a human-readable identifier for the provider. */
  DisplayName(): string

  /**
   * FetchUser retrieves the authenticated user's profile from the provider
   * using the provided access token.
   *
   * @param token  OAuth2 access token.
   * @param client Optional fetch-compatible HTTP client.
   */
  FetchUser(token: string, client?: HttpClient): Promise<AuthUser>
}
