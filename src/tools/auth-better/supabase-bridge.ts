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
 * GoTrue-compatible session response. The access token is the better-auth
 * session token; the refresh token is the opaque `refresh_tokens` value.
 *
 * Expected input shape:
 *   { token: string, user: { id, email, emailVerified?, createdAt?, updatedAt?, ... } }
 */
export function bridgeSignInResponse(
  result: BetterAuthSignInResult,
  refreshToken: string,
): Session {
  const { id, email, role, createdAt, updatedAt } = result.user
  const user = toSinopebaseUser({
    id,
    email,
    role: role ?? 'authenticated',
    createdAt: toDate(createdAt),
    updatedAt: toDate(updatedAt),
  })
  return toSinopebaseSession(user, result.token, refreshToken, ACCESS_TOKEN_EXPIRES_IN)
}

function toDate(value: Date | string | undefined): Date {
  return value ? new Date(value) : new Date()
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
