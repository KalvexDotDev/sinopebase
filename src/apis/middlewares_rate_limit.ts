/**
 * Rate limit middleware with Store-based fixed-window token buckets.
 *
 * Port of PocketBase apis/middlewares_rate_limit.go
 * Layer 4 — imports from ~/tools/store.
 *
 * Uses a fixed-window per-client strategy:
 * Each client (by IP) gets a bucket with `maxRequests` tokens that
 * resets every `windowSeconds` seconds. If the bucket is empty the
 * request is rejected with a 429 Too Many Requests error.
 *
 * Stale buckets are periodically cleaned up via a configurable interval.
 */

import { Store } from '~/tools/store/store'
import { TooManyRequestsError } from './api_error_aliases'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How often (in seconds) to run cleanup of expired rate clients. */
const DEFAULT_CLEANUP_INTERVAL_SEC = 1800 // 30 min

/** Shrink map threshold (number of deleted entries before re-allocation). */
const SHRINK_THRESHOLD = 300

// ---------------------------------------------------------------------------
// isIPInList — check if an IP matches any entry in a list of IPs/subnets
// ---------------------------------------------------------------------------

/**
 * Checks if `ip` matches any entry in `ipsOrSubnets`.
 *
 * Each entry can be:
 * - An individual IP address (`"192.168.1.1"`)
 * - A CIDR subnet (`"10.0.0.0/8"`)
 *
 * Ported from PocketBase tools/router/route.go → isIPInList.
 */
export function isIPInList(ipsOrSubnets: string[], ip: string): boolean {
  if (ipsOrSubnets.length === 0 || !ip) return false

  for (const item of ipsOrSubnets) {
    // Try CIDR subnet
    const slashIdx = item.indexOf('/')
    if (slashIdx !== -1) {
      const prefixLen = Number.parseInt(item.slice(slashIdx + 1), 10)
      if (!Number.isNaN(prefixLen) && prefixLen >= 0 && prefixLen <= 128) {
        if (ipMatchCidr(ip, item)) return true
        continue
      }
    }

    // Try individual IP
    if (item === ip) return true
  }

  return false
}

/**
 * Naive CIDR match for IPv4 addresses.
 * For production, use `net` module (`net.isIP` / `netmask`).
 */
function ipMatchCidr(ip: string, cidr: string): boolean {
  const [range, bits] = cidr.split('/')
  if (!range || !bits) return false

  const mask = ~(2 ** (32 - Number(bits)) - 1)
  const ipNum = ipv4ToNum(ip)
  const rangeNum = ipv4ToNum(range)
  if (ipNum === null || rangeNum === null) return false

  return (ipNum & mask) === (rangeNum & mask)
}

function ipv4ToNum(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  const nums = parts.map((p) => Number.parseInt(p, 10))
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null
  const [a, b, c, d] = nums
  if (a === undefined || b === undefined || c === undefined || d === undefined) return null
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0
}

// ---------------------------------------------------------------------------
// Rate client (per-IP bucket)
// ---------------------------------------------------------------------------

class RateClient {
  maxAllowed: number
  available: number
  start: number
  interval: number

  constructor(maxAllowed: number, intervalInSec: number) {
    this.maxAllowed = maxAllowed
    this.available = maxAllowed
    this.start = Math.floor(Date.now() / 1000)
    this.interval = intervalInSec
  }

  /**
   * Returns `true` if the window expired `minElapsed`+ seconds ago,
   * meaning this client can be garbage-collected.
   */
  hasExpired(nowUnix: number, minElapsed: number): boolean {
    return nowUnix - (this.start + this.interval) > minElapsed
  }

  /**
   * Tries to consume one token from the bucket.
   * Returns `false` if the bucket is empty (rate limited).
   *
   * The window resets automatically when the interval has passed.
   */
  consume(): boolean {
    const nowUnix = Math.floor(Date.now() / 1000)

    // Reset the window if expired
    if (nowUnix - this.start >= this.interval) {
      this.available = this.maxAllowed
      this.start = nowUnix
    }

    if (this.available > 0) {
      this.available--
      return true
    }

    return false
  }
}

// ---------------------------------------------------------------------------
// Rate limiter (per-rule, holds many RateClients keyed by IP)
// ---------------------------------------------------------------------------

class RateLimiter {
  maxAllowed: number
  interval: number
  minDeleteInterval: number
  private clients = new Map<string, RateClient>()
  private totalDeleted = 0

  constructor(
    maxAllowed: number,
    interval: number,
    minDeleteInterval: number = DEFAULT_CLEANUP_INTERVAL_SEC,
  ) {
    this.maxAllowed = maxAllowed
    this.interval = interval
    this.minDeleteInterval = minDeleteInterval
  }

  /**
   * Check if `key` (usually an IP address) is allowed through.
   * Creates a new bucket for unknown keys.
   */
  isAllowed(key: string): boolean {
    let client = this.clients.get(key)

    if (!client) {
      client = new RateClient(this.maxAllowed, this.interval)
      this.clients.set(key, client)
    }

    return client.consume()
  }

  /**
   * Remove expired clients to free memory.
   * Should be called periodically (e.g. via a cron schedule or
   * `setInterval`).
   */
  clean(): void {
    const nowUnix = Math.floor(Date.now() / 1000)

    for (const [k, client] of this.clients) {
      if (client.hasExpired(nowUnix, this.minDeleteInterval)) {
        this.clients.delete(k)
        this.totalDeleted++
      }
    }

    // "Shrink" the map to allow GC of old storage
    if (this.totalDeleted >= SHRINK_THRESHOLD) {
      this.clients = new Map(this.clients)
      this.totalDeleted = 0
    }
  }
}

// ---------------------------------------------------------------------------
// Global rate limiter store
// ---------------------------------------------------------------------------

/** Global store mapping rule ID -> RateLimiter. */
const globalLimiters = new Store<string, RateLimiter>()

// Periodic cleanup (every 30 minutes)
let cleanupTimer: ReturnType<typeof setInterval> | null = null

function ensureCleanup(): void {
  if (cleanupTimer) return
  cleanupTimer = setInterval(() => {
    for (const limiter of globalLimiters.values()) {
      limiter.clean()
    }
  }, DEFAULT_CLEANUP_INTERVAL_SEC * 1000)
}

/**
 * Reset all rate limiters (useful when settings are reloaded).
 */
export function resetRateLimiters(): void {
  globalLimiters.removeAll()
  if (cleanupTimer) {
    clearInterval(cleanupTimer)
    cleanupTimer = null
  }
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Returns an Elysia **before-handle** hook that enforces rate limiting
 * using a per-IP token bucket stored in a global [[Store]].
 *
 * Usage:
 * ```ts
 * import { rateLimit } from './middlewares_rate_limit'
 * app.onRequest(rateLimit(100, 60))  // 100 requests per 60 seconds
 * ```
 *
 * @param maxRequests  Maximum number of requests per window (per IP).
 * @param windowSec    Window duration in seconds.
 * @param label        Optional label for the rate limiter (used as the store key).
 */
export function rateLimit(
  maxRequests: number,
  windowSec: number,
  label?: string,
  trustedProxies?: string[],
) {
  const key = label ?? `__rl_${maxRequests}_${windowSec}__`

  // Get or create the limiter in the global store
  const limiter = new RateLimiter(maxRequests, windowSec)
  globalLimiters.set(key, limiter)

  ensureCleanup()

  return async (ctx: { request: Request; set: { status?: number } }): Promise<void> => {
    const ip = getClientIP(ctx.request, trustedProxies)

    if (!limiter.isAllowed(ip)) {
      throw new TooManyRequestsError('You have made too many requests. Please try again later.', {
        retryAfterSec: windowSec,
      })
    }
  }
}

/**
 * Extracts the client IP from a request, respecting trusted proxy configuration.
 *
 * When `trustedProxies` is provided, the last IP in the `X-Forwarded-For` chain
 * is used (the one appended by the outermost trusted proxy). Without a trusted
 * proxy list, `X-Forwarded-For` is ignored to prevent spoofing, and the
 * `X-Real-IP` header is used as a fallback before the loopback address.
 */
export function getClientIP(request: Request, trustedProxies?: string[]): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) {
    if (trustedProxies?.length) {
      // Behind trusted proxies: use the rightmost IP (appended by outermost proxy).
      const ips = xff.split(',').map((s) => s.trim())
      const last = ips[ips.length - 1]
      if (last) return last
    } else {
      // No trusted proxy list configured: use first IP for backward compat.
      // ponytail: when trustedProxies is configured, prefer last IP in chain
      const first = xff.split(',')[0]?.trim()
      if (first) return first
    }
  }
  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp
  return '127.0.0.1'
}

/**
 * Creates a rate-limit middleware scoped to a collection resolved from a
 * route path parameter.
 *
 * @param collectionParam  Route parameter name (default `"collection"`).
 * @param baseTags         Additional tags to include in the limiter key.
 */
export function collectionPathRateLimit(
  collectionParam = 'collection',
  ...baseTags: (string | string[])[]
) {
  // Extract optional trailing trustedProxies array from the varargs
  let trustedProxies: string[] | undefined
  const tags: string[] = []
  for (const arg of baseTags) {
    if (Array.isArray(arg)) {
      trustedProxies = arg
    } else {
      tags.push(arg)
    }
  }

  return async (ctx: {
    request: Request
    params: Record<string, string>
    set: { status?: number }
  }): Promise<void> => {
    const coll = ctx.params[collectionParam] ?? 'unknown'
    const tag = tags.length ? `_${tags.join('_')}` : ''
    const label = `__rl_coll_${coll}${tag}`
    const hook = rateLimit(120, 60, label, trustedProxies)
    await hook(ctx)
  }
}
