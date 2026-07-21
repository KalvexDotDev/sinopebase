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

function getSecret(): Uint8Array {
  const secret =
    process.env.JWT_SECRET ?? 'sinopebase-dev-jwt-secret-min-32-chars!!'
  return new TextEncoder().encode(secret)
}

const ACCESS_TOKEN_EXPIRES_IN = 3600 // 1 hour in seconds

export async function generateAccessToken(user: User): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({
    sub: user.id,
    email: user.email,
    role: user.role,
    aud: user.aud,
    jti: crypto.randomUUID(),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TOKEN_EXPIRES_IN)
    .sign(getSecret())
}

export async function verifyAccessToken(
  token: string,
): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, getSecret())
  return payload as unknown as JwtPayload
}

export function generateRefreshToken(): string {
  return crypto.randomUUID()
}

export { ACCESS_TOKEN_EXPIRES_IN }
