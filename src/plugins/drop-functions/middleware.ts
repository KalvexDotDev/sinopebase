// ---------------------------------------------------------------------------
// DropFunctions — Auth & rate-limiting middleware
// ---------------------------------------------------------------------------

import { lookupSessionByToken } from '~/tools/auth-better'
import type { FunctionAuth } from './types'

/**
 * Extract and validate a Bearer token via direct DB lookup.
 *
 * Uses the same pattern as createAuthPlugin in src/apis/auth.ts —
 * better-auth's getSession is cookie-based, so we query the session table
 * directly for Bearer token validation.
 *
 * Returns the auth context or null if the token is invalid/missing.
 */
export async function validateFunctionAuth(
  auth: unknown,
  token: string | null,
): Promise<FunctionAuth | null> {
  if (!token) return null
  if (!auth) return null

  try {
    const row = await lookupSessionByToken(auth, token)
    if (!row) return null
    return {
      userId: row.id,
      email: row.email,
      role: row.role || 'authenticated',
    }
  } catch {
    return null
  }
}

/**
 * Extract the Bearer token from a Request.
 */
export function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get('authorization') ?? ''
  if (authHeader.length > 7 && authHeader.slice(0, 7).toLowerCase() === 'bearer ') {
    return authHeader.slice(7)
  }
  return authHeader || null
}

// ---------------------------------------------------------------------------
// Rate limiter — simple in-memory per-IP + per-function tracking
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  count: number
  resetAt: number
}

const rateLimitStore = new Map<string, RateLimitEntry>()

/**
 * Check if a request should be rate-limited.
 *
 * Returns true if the request is allowed, false if the limit is exceeded.
 */
export function checkRateLimit(
  ip: string,
  functionName: string,
  maxRequests: number,
  windowMs: number,
): boolean {
  ensureCleanupTimer()
  const key = `${ip}:${functionName}`
  const now = Date.now()
  const entry = rateLimitStore.get(key)

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }

  entry.count++
  if (entry.count > maxRequests) {
    return false
  }

  return true
}

/**
 * Parse a rate-limit window string ("1m", "5m", "1h") to milliseconds.
 */
export function parseWindow(window: string): number {
  const match = window.match(/^(\d+)(s|m|h|d)$/)
  if (!match) return 60_000 // default 1m
  const value = Number(match[1])
  const unit = match[2]
  switch (unit) {
    case 's':
      return value * 1000
    case 'm':
      return value * 60_000
    case 'h':
      return value * 3_600_000
    case 'd':
      return value * 86_400_000
    default:
      return 60_000
  }
}

// Lazily-init'd cleanup timer for stale rate-limit entries
let cleanupTimer: ReturnType<typeof setInterval> | null = null

function ensureCleanupTimer(): void {
  if (cleanupTimer) return
  cleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of rateLimitStore) {
      if (now > entry.resetAt) {
        rateLimitStore.delete(key)
      }
    }
  }, 300_000).unref()
}
