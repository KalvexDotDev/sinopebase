import type { Session, User } from '~/sdk/auth'
import { ACCESS_TOKEN_EXPIRES_IN, toSinopebaseSession, toSinopebaseUser } from './types'

export interface GoTrueErrorResponse {
  message: string
  status: number
}

export interface BetterAuthSignInResult {
  token: string
  user: {
    id: string
    email: string
    emailVerified?: boolean
    name?: string | null
    image?: string | null
    role?: string
    createdAt?: Date | string
    updatedAt?: Date | string
  }
}

export interface BetterAuthGetSessionResult {
  session: Record<string, unknown>
  user: {
    id: string
    email: string
    emailVerified: boolean
    name: string | null
    image: string | null
    role: string
    createdAt: Date
    updatedAt: Date
  }
}

/**
 * Translate a better-auth signIn / signUp response into a raw
 * GoTrue-compatible session response.
 *
 * Expected input shape:
 *   { token: string, user: { id, email, emailVerified?, createdAt?, updatedAt?, ... } }
 */
export function bridgeSignInResponse(
  result: BetterAuthSignInResult | null,
): Session | GoTrueErrorResponse {
  if (!result?.token || !result.user) {
    return bridgeErrorResponse('Authentication failed', 400)
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

  return session
}

/**
 * Translate a better-auth getSession result into a raw GoTrue user response.
 *
 * Expected input shape:
 *   { session: {...}, user: { id, email, ... } } | null
 */
export function bridgeGetUserResponse(
  result: BetterAuthGetSessionResult | null,
): User | GoTrueErrorResponse {
  if (!result?.user) {
    return bridgeErrorResponse('Invalid token', 401)
  }

  return toSinopebaseUser(result.user)
}

/**
 * Build an error payload that GoTrue clients can parse.
 */
export function bridgeErrorResponse(message: string, status: number = 400): GoTrueErrorResponse {
  return { message, status }
}
