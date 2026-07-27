import type { AuthResponse, Session, User } from '~/sdk/auth'

/**
 * better-auth user shape (v1.6.23).
 * Mirrors the default fields returned by better-auth's `auth.api.listUsers` / `getSession`.
 */
export interface BetterAuthUser {
  id: string
  email: string
  emailVerified: boolean
  name: string | null
  image: string | null
  role: string
  createdAt: Date
  updatedAt: Date
}

/**
 * Seconds until a raw access token expires.
 * Used as the default when better-auth does not communicate an explicit expiry.
 */
export const ACCESS_TOKEN_EXPIRES_IN = 3600

/**
 * Map a better-auth `User` to the Sinopebase (supabase-js) `User` shape.
 */
export function toSinopebaseUser(u: BetterAuthUser): User {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    aud: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: u.createdAt.toISOString(),
    updated_at: u.updatedAt.toISOString(),
  }
}

/**
 * Build a Sinopebase `Session` from an already-mapped `User` and raw tokens.
 */
export function toSinopebaseSession(
  user: User,
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
): Session {
  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    refresh_token: refreshToken,
    user,
  }
}

/**
 * Build a `{ data, error }` API response in the supabase-js convention.
 *
 * When `error` is provided the response carries an error object and null data;
 * otherwise it carries the supplied user and session and a null error.
 */
export function toAuthResponse(
  user: User | null,
  session: Session | null,
  error?: string,
  status?: number,
): AuthResponse {
  if (error) {
    return {
      data: { user: null, session: null },
      error: { message: error, status: status ?? 400 },
    }
  }

  return {
    data: { user, session },
    error: null,
  }
}
