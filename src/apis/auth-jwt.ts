/**
 * JWT helpers using the jose library.
 */

import { SignJWT, jwtVerify } from 'jose'
import type { User } from '../sdk/auth'

export interface JwtPayload {
  sub: string
  email: string
  role: string
  aud: string
  exp: number
  iat: number
}

const JWT_DEV_FALLBACK = 'sinopebase-dev-jwt-secret-min-32-chars!!'

function getSecret(): Uint8Array {
  const secret = process.env['JWT_SECRET'] ?? JWT_DEV_FALLBACK
  if (secret === JWT_DEV_FALLBACK && process.env['POSTGRES_URL']) {
    console.warn(
      '⚠ JWT_SECRET is using the dev fallback in PostgreSQL mode. ' +
      'Set JWT_SECRET to a cryptographically random value in production.',
    )
  }
  return new TextEncoder().encode(secret)
}

const ACCESS_TOKEN_EXPIRES_IN = 3600 // 1 hour in seconds

const TOKEN_ISSUER = 'sinopebase'
const TOKEN_AUDIENCE = 'authenticated'

export async function generateAccessToken(user: User): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({
    sub: user.id,
    email: user.email,
    role: user.role,
    aud: user.aud ?? TOKEN_AUDIENCE,
    jti: crypto.randomUUID(),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(TOKEN_ISSUER)
    .setAudience(TOKEN_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TOKEN_EXPIRES_IN)
    .sign(getSecret())
}

export async function verifyAccessToken(
  token: string,
): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, getSecret(), {
    issuer: TOKEN_ISSUER,
    audience: TOKEN_AUDIENCE,
  })
  return payload as unknown as JwtPayload
}

export function generateRefreshToken(): string {
  return crypto.randomUUID()
}

export { ACCESS_TOKEN_EXPIRES_IN }
