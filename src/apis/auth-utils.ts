// ---------------------------------------------------------------------------
// Shared auth utilities — extracted from multiple duplicated implementations
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
