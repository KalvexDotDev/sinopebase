// ---------------------------------------------------------------------------
// Shared auth utilities — extracted from multiple duplicated implementations
// ---------------------------------------------------------------------------

import { decodeJwt } from 'jose'

// ---------------------------------------------------------------------------
// Token identifier generators
// ---------------------------------------------------------------------------

/** Generate a cryptographically random session identifier. */
export function generateSessionId(): string {
  return crypto.randomUUID()
}

/** Generate a cryptographically random token identifier (jti). */
export function generateTokenId(): string {
  return crypto.randomUUID()
}

/** Generate a cryptographically random refresh token family identifier. */
export function generateFamilyId(): string {
  return crypto.randomUUID()
}

// ---------------------------------------------------------------------------
// Token inspection (unverified — for routing / logging / expiry checks)
// ---------------------------------------------------------------------------

/**
 * Check if a decoded token (or token string) is expired, with an optional
 * leeway window in seconds.
 *
 * Returns true if the token has no `exp` claim or is past its expiry + leeway.
 */
export function isTokenExpired(token: { exp?: number } | string, leewaySec = 0): boolean {
  let exp: number | undefined
  if (typeof token === 'string') {
    try {
      exp = decodeJwt(token).exp
    } catch {
      return true
    }
  } else {
    exp = token.exp
  }
  if (exp === undefined) return true
  return Math.floor(Date.now() / 1000) > exp + leewaySec
}

/**
 * Read the `kid` from a JWT's unprotected header (no verification).
 * Returns undefined if the header cannot be parsed.
 */
export function getTokenKid(token: string): string | undefined {
  try {
    const parts = token.split('.')
    const firstPart = parts[0]
    if (!firstPart) return undefined
    const header = JSON.parse(atob(firstPart))
    return header.kid as string | undefined
  } catch {
    return undefined
  }
}

/**
 * Read the `sid` (session ID) claim from a JWT payload without verification.
 * Returns undefined if the token cannot be decoded.
 */
export function getTokenSessionId(token: string): string | undefined {
  try {
    const payload = decodeJwt(token)
    return payload.sid as string | undefined
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// Bearer token extraction
// ---------------------------------------------------------------------------

/**
 * Extract a Bearer token from a Request's Authorization header.
 *
 * Returns the raw token string (without "Bearer " prefix), or null if
 * no token is present. This is the single canonical implementation —
 * previously duplicated across 10+ call sites in the codebase.
 */
export function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get('authorization') ?? ''
  if (authHeader.length > 7 && authHeader.slice(0, 7).toLowerCase() === 'bearer ') {
    return authHeader.slice(7).trim()
  }
  // Also accept the raw header value if it doesn't have a Bearer prefix
  // (PocketBase compatibility — some clients send the raw token)
  return authHeader || null
}
