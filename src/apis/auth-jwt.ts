/**
 * JWT helpers using the jose library.
 *
 * Access tokens: short-lived JWTs with kid in the protected header.
 * Refresh tokens: structured JWTs with family tracking for replay detection.
 */

import { jwtVerify, SignJWT } from 'jose'
import { JWT_DEV_FALLBACK } from '~/tools/security/constants'
import type { User } from '../sdk/auth'

export interface JwtPayload {
  sub: string
  email: string
  role: string
  aud: string
  exp: number
  iat: number
  /** Session identifier — used for targeted invalidation */
  sid?: string
}

export interface JwtRefreshPayload {
  sub: string
  sid: string
  jti: string
  family: string
  iat: number
  exp: number
  iss: string
  aud: string
}

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET ?? JWT_DEV_FALLBACK
  if (secret === JWT_DEV_FALLBACK && process.env.POSTGRES_URL) {
    console.warn(
      '⚠ JWT_SECRET is using the dev fallback in PostgreSQL mode. ' +
        'Set JWT_SECRET to a cryptographically random value in production.',
    )
  }
  return new TextEncoder().encode(secret)
}

export const ACCESS_TOKEN_TTL = 3600 // 1 hour in seconds
export const REFRESH_TOKEN_TTL = 604800 // 7 days in seconds

/** @deprecated Use ACCESS_TOKEN_TTL instead */
export const ACCESS_TOKEN_EXPIRES_IN = ACCESS_TOKEN_TTL

const TOKEN_ISSUER = 'sinopebase'
const TOKEN_AUDIENCE = 'authenticated'

export async function generateAccessToken(user: User, sessionId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({
    sub: user.id,
    email: user.email,
    role: user.role,
    aud: user.aud ?? TOKEN_AUDIENCE,
    sid: sessionId,
    jti: crypto.randomUUID(),
  })
    .setProtectedHeader({ alg: 'HS256', kid: 'sinopebase-v1' })
    .setIssuer(TOKEN_ISSUER)
    .setAudience(TOKEN_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TOKEN_TTL)
    .sign(getSecret())
}

export async function verifyAccessToken(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, getSecret(), {
    issuer: TOKEN_ISSUER,
    audience: TOKEN_AUDIENCE,
  })
  return payload as unknown as JwtPayload
}

export async function generateRefreshToken(
  userId: string,
  sessionId: string,
  tokenId: string,
  familyId: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({
    sub: userId,
    sid: sessionId,
    jti: tokenId,
    family: familyId,
  })
    .setProtectedHeader({ alg: 'HS256', kid: 'sinopebase-v1' })
    .setIssuer(TOKEN_ISSUER)
    .setAudience(TOKEN_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + REFRESH_TOKEN_TTL)
    .sign(getSecret())
}

export async function verifyRefreshToken(token: string): Promise<JwtRefreshPayload> {
  const { payload } = await jwtVerify(token, getSecret(), {
    issuer: TOKEN_ISSUER,
    audience: TOKEN_AUDIENCE,
  })
  return payload as unknown as JwtRefreshPayload
}
