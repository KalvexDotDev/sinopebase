import type { User, Session, AuthResponse } from '~/sdk/auth'
import { toSinopebaseUser, toSinopebaseSession, toAuthResponse, ACCESS_TOKEN_EXPIRES_IN } from './types'

/**
 * Translate a better-auth signIn / signUp response into a supabase-js
 * GoTrue-compatible AuthResponse.
 *
 * Expected input shape:
 *   { token: string, user: { id, email, emailVerified?, createdAt?, updatedAt?, ... } }
 */
export function bridgeSignInResponse(result: any): AuthResponse {
  if (!result || !result.token) {
    return toAuthResponse(null, null, 'Authentication failed', 400)
  }

  const user = toSinopebaseUser({
    id: result.user.id,
    email: result.user.email,
    emailVerified: result.user.emailVerified ?? false,
    name: result.user.name ?? null,
    image: result.user.image ?? null,
    role: result.user.role ?? 'authenticated',
    createdAt: result.user.createdAt ? new Date(result.user.createdAt) : new Date(),
    updatedAt: result.user.updatedAt ? new Date(result.user.updatedAt) : new Date(),
  })

  // Use the session token as refresh_token so the refresh flow can validate it
  const refreshToken = result.token
  const session = toSinopebaseSession(user, result.token, refreshToken, ACCESS_TOKEN_EXPIRES_IN)

  return toAuthResponse(user, session)
}

/**
 * Translate a better-auth getSession result into a GoTrue-compatible
 * { data: { user }, error } shape.
 *
 * Expected input shape:
 *   { session: {...}, user: { id, email, ... } } | null
 */
export function bridgeGetUserResponse(result: any): {
  data: { user: User | null }
  error: { message: string; status: number } | null
} {
  if (!result || !result.user) {
    return { data: { user: null }, error: { message: 'Invalid token', status: 401 } }
  }

  return {
    data: { user: toSinopebaseUser(result.user) },
    error: null,
  }
}

/**
 * Build a standard AuthResponse error in the supabase-js convention.
 */
export function bridgeErrorResponse(message: string, status: number = 400): AuthResponse {
  return toAuthResponse(null, null, message, status)
}
