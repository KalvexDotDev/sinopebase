/**
 * CORS middleware for Elysia.
 *
 * Port of PocketBase apis/middlewares_cors.go
 * Layer 4 — imports from ~/tools/*.
 *
 * Provides configurable per-route/per-app CORS headers with support for:
 * - Wildcard origins (`*`)
 * - Sub-domain wildcards (`http://*.example.com`)
 * - Origin functions for dynamic matching
 * - Preflight (OPTIONS) handling
 * - Credentials, exposed headers, max-age
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface CORSConfig {
  /** Allowed origins (e.g. `["*"]`, `["https://example.com"]`). */
  allowOrigins?: string[]

  /**
   * Optional dynamic origin resolver.
   * Return `true` to allow the origin, `false` to reject.
   * When set, `allowOrigins` is ignored.
   */
  allowOriginFunc?: (origin: string) => boolean | Promise<boolean>

  /** Allowed HTTP methods (default: GET, HEAD, PUT, PATCH, POST, DELETE). */
  allowMethods?: string[]

  /** Allowed request headers. */
  allowHeaders?: string[]

  /** Whether to include `Access-Control-Allow-Credentials: true`. */
  allowCredentials?: boolean

  /**
   * When `true`, a wildcard origin `*` combined with credentials will echo
   * the request `Origin` header back (unsafe — use only when necessary).
   */
  unsafeWildcardOriginWithAllowCredentials?: boolean

  /** Headers exposed to the client via `Access-Control-Expose-Headers`. */
  exposeHeaders?: string[]

  /** `Access-Control-Max-Age` in seconds (default 0). */
  maxAge?: number
}

export const DEFAULT_CORS_CONFIG: CORSConfig = {
  allowOrigins: ['*'],
  allowMethods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function matchScheme(domain: string, pattern: string): boolean {
  const didx = domain.indexOf(':')
  const pidx = pattern.indexOf(':')
  return didx !== -1 && pidx !== -1 && domain.slice(0, didx) === pattern.slice(0, pidx)
}

/**
 * Shallow wildcard sub-domain matching.
 *
 * `http://*.example.com` matches `http://foo.example.com` but NOT
 * `http://example.com`.
 */
function matchSubdomain(domain: string, pattern: string): boolean {
  if (!matchScheme(domain, pattern)) return false

  const didx = domain.indexOf('://')
  const pidx = pattern.indexOf('://')
  if (didx === -1 || pidx === -1) return false

  const domAuth = domain.slice(didx + 3)
  if (domAuth.length > 253) return false
  const patAuth = pattern.slice(pidx + 3)

  const domComp = domAuth.split('.').reverse()
  const patComp = patAuth.split('.').reverse()

  for (let i = 0; i < domComp.length; i++) {
    if (patComp.length <= i) return false
    const p = patComp[i]
    if (!p) return false
    if (p === '*') return true
    if (p !== domComp[i]) return false
  }

  return true
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Creates an Elysia **onRequest** hook (or guard) that sets CORS headers
 * and short-circuits OPTIONS preflight requests.
 *
 * Usage:
 * ```ts
 * import { cors } from './middlewares_cors'
 * app.onRequest(cors({ allowOrigins: ['https://app.example.com'] }))
 * ```
 */
export function cors(config: CORSConfig = {}) {
  const cfg = { ...DEFAULT_CORS_CONFIG, ...config }

  const allowMethods = cfg.allowMethods?.join(',') ?? ''
  const allowHeaders = cfg.allowHeaders?.join(',') ?? ''
  const exposeHeaders = cfg.exposeHeaders?.join(',') ?? ''
  const maxAge = cfg.maxAge != null && cfg.maxAge > 0 ? String(cfg.maxAge) : '0'

  // Pre-compile origin patterns for wildcard/regex matching
  const originPatterns: RegExp[] = []
  for (const origin of cfg.allowOrigins ?? []) {
    if (origin === '*') continue
    let pattern = origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    pattern = pattern.replace(/\\\*/g, '.*')
    pattern = pattern.replace(/\\\?/g, '.')
    try {
      originPatterns.push(new RegExp(`^${pattern}$`))
    } catch {
      console.warn(`[cors] invalid origin pattern: ${origin}`)
    }
  }

  return async (ctx: {
    request: Request
    set: {
      status?: number
      headers: Record<string, string>
    }
  }) => {
    const req = ctx.request
    const res = ctx.set
    const origin = req.headers.get('origin') ?? ''
    const isPreflight = req.method === 'OPTIONS'

    res.headers.vary = 'Origin'

    if (!origin) {
      if (!isPreflight) return
      ctx.set.status = 204
      return
    }

    let allowOrigin = ''

    // 1. Dynamic resolver
    if (cfg.allowOriginFunc) {
      const allowed = await cfg.allowOriginFunc(origin)
      if (allowed) allowOrigin = origin
    } else {
      // 2. Static list matching
      for (const o of cfg.allowOrigins ?? []) {
        if (o === '*' && cfg.allowCredentials && cfg.unsafeWildcardOriginWithAllowCredentials) {
          allowOrigin = origin
          break
        }
        if (o === '*' || o === origin) {
          allowOrigin = o
          break
        }
        if (matchSubdomain(origin, o)) {
          allowOrigin = origin
          break
        }
      }

      // 3. Regex patterns
      if (!allowOrigin && origin.length <= 261 && origin.includes('://')) {
        for (const re of originPatterns) {
          if (re.test(origin)) {
            allowOrigin = origin
            break
          }
        }
      }
    }

    if (!allowOrigin) {
      if (!isPreflight) return
      ctx.set.status = 204
      return
    }

    res.headers['access-control-allow-origin'] = allowOrigin
    if (cfg.allowCredentials) {
      res.headers['access-control-allow-credentials'] = 'true'
    }

    if (!isPreflight) {
      if (exposeHeaders) {
        res.headers['access-control-expose-headers'] = exposeHeaders
      }
      return
    }

    // Preflight
    res.headers.vary = 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers'
    res.headers['access-control-allow-methods'] = allowMethods

    if (allowHeaders) {
      res.headers['access-control-allow-headers'] = allowHeaders
    } else {
      const reqHeaders = req.headers.get('access-control-request-headers')
      if (reqHeaders) {
        res.headers['access-control-allow-headers'] = reqHeaders
      }
    }

    if (maxAge !== '0') {
      res.headers['access-control-max-age'] = maxAge
    }

    ctx.set.status = 204
  }
}
