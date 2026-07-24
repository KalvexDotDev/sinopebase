/**
 * Router factory — creates and configures the Elysia app instance with all
 * default middleware and route groups.
 *
 * Port of PocketBase apis/base.go
 * Layer 4 — imports from ~/core/*, ~/tools/*, and sibling apis modules.
 *
 * `NewRouter()` returns a fully-wired Elysia application with:
 * - Default middleware stack (auth, rate limit, security, body limit, …)
 * - All API route groups mounted under /api/
 * - Static file serving for the admin UI (/_/)
 * - CORS, gzip, and www-redirect applied at the top level
 */

import { Elysia } from 'elysia'

// Core / tool imports
import type { App } from '~/core/app'
import { ConsoleLogger } from '~/tools/logger/log'
import { Store } from '~/tools/store/store'

// API route groups (to be ported — wire them as they become available)
// import { bindSettingsApi } from './settings'
// import { bindCollectionApi } from './collection'
// import { bindRecordCrudApi } from './record_crud'
// import { bindRecordAuthApi } from './record_auth'
// import { bindLogsApi } from './logs'
// import { bindBackupApi } from './backup'
// import { bindCronApi } from './cron'
// import { bindFileApi } from './file'
// import { bindBatchApi } from './batch'
// import { bindRealtimeApi } from './realtime'
// import { bindHealthApi } from './health'
// import { bindSQLApi } from './sql'

// Middleware
import {
  registerDefaultMiddleware,
  registerActivityLogger,
  securityHeaders,
  loadAuthToken,
  wwwRedirect,
} from './middlewares'
import { bodyLimit, DEFAULT_MAX_BODY_SIZE } from './middlewares_body_limit'
import { cors, type CORSConfig } from './middlewares_cors'
import { configureGzip } from './middlewares_gzip'

// ---------------------------------------------------------------------------
// Router options
// ---------------------------------------------------------------------------

export interface RouterOptions {
  /** Allowed CORS origins. */
  corsConfig?: CORSConfig

  /** WWW redirect hosts (www -> non-www). */
  wwwRedirectHosts?: string[]

  /** Maximum request body size in bytes (default 32 MiB). */
  maxBodySize?: number

  /** Global rate limit: [maxRequests, windowSec] (optional). */
  rateLimit?: [number, number]

  /** Whether to show the startup banner. */
  showStartBanner?: boolean

  /** Base URL for the server (e.g. "http://127.0.0.1:8090"). */
  baseURL?: string
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

/**
 * Creates a new Elysia application wired with the PocketBase-compatible
 * middleware stack and all API route groups.
 *
 * Usage:
 * ```ts
 * const app = await NewRouter(sinopebaseApp, { baseURL: 'http://localhost:8090' })
 * app.listen(8090)
 * ```
 *
 * @param app       The Sinopebase (or PocketBase-compatible) core App instance.
 * @param options   Optional configuration for middleware and routes.
 * @returns         A configured Elysia application.
 */
export async function NewRouter(
  app: App,
  options: RouterOptions = {},
): Promise<Elysia> {
  const logger = new ConsoleLogger()

  const elysia = new Elysia({
    name: 'sinopebase',
    seed: app, // make the app instance available via `app.store['app']`
  })

  // ── Store the app reference for middleware to access ──
  elysia.state('app', app)
  elysia.state('logger', logger)
  elysia.state('store', new Store<string, unknown>())

  // ── CORS ──
  const applyCors = cors(options.corsConfig ?? { allowOrigins: ['*'] })
  elysia.onRequest((ctx) => applyCors({
    request: ctx.request,
    set: ctx.set as Parameters<typeof applyCors>[0]['set'],
  }))

  // ── Gzip compression ──
  // Elysia v1.4+ provides built-in compression.
  // To enable, use the @elysiajs/compress plugin or configure Bun's
  // built-in compression at the server level.
  // The configureGzip function provides the PocketBase-compatible config.
  configureGzip()

  // ── WWW redirect ──
  if (options.wwwRedirectHosts && options.wwwRedirectHosts.length > 0) {
    elysia.onRequest(wwwRedirect(options.wwwRedirectHosts))
  }

  // ── Default middleware stack ──
  registerDefaultMiddleware(elysia)

  // ── API group: /api ──
  const api = new Elysia({ prefix: '/api', name: 'api' })

  // Per-group middleware
  api.onRequest(loadAuthToken())
  api.onRequest(securityHeaders())
  api.onRequest(
    bodyLimit(options.maxBodySize ?? DEFAULT_MAX_BODY_SIZE),
  )

  // Route groups (mount as they are ported)
  // bindHealthApi(app, api)
  // bindCollectionApi(app, api)
  // bindRecordCrudApi(app, api)
  // bindRecordAuthApi(app, api)
  // bindLogsApi(app, api)
  // bindBackupApi(app, api)
  // bindCronApi(app, api)
  // bindFileApi(app, api)
  // bindBatchApi(app, api)
  // bindRealtimeApi(app, api)
  // bindSQLApi(app, api)

  // ── Health endpoint (always available) ──
  api.get('/health', () => ({
    code: 200,
    message: 'API is healthy.',
    data: {},
  }))

  // Mount the /api group
  elysia.use(api)

  // ── Admin UI static files: /_/{path...} ──
  // Serves the bundled PocketBase admin SPA.
  // If `ui.DistDirFS` is available, serve it; otherwise skip.
  // (To be implemented when the admin UI is bundled.)

  // ── Activity logger (end hooks) ──
  // Register after all routes so errors propagate correctly.
  registerActivityLogger(elysia)

  // ── Catch-all: 501 for unimplemented routes ──
  elysia.all('/api/*', ({ set }) => {
    set.status = 501
    return { message: 'API endpoint not yet implemented.', code: 501 }
  })

  // ── Startup banner ──
  if (options.showStartBanner) {
    const baseURL = options.baseURL ?? 'http://127.0.0.1:8090'
    console.log(`\n  Server started at ${baseURL}`)
    console.log(`  ├─ REST API:  ${baseURL}/api/`)
    console.log(`  └─ Dashboard: ${baseURL}/_/\n`)
  }

  return elysia
}

// ── Static file serving helper (ported from Go apis/base.go) ──

/**
 * Returns an Elysia route handler that serves static files from the
 * provided `fsys` filesystem, similar to Go's `http.FileServer`.
 *
 * If `indexFallback` is true, missing routes fall back to `index.html`
 * (SPA-friendly).
 *
 * Expects a `{path...}` wildcard param in the route.
 *
 * @example
 * ```ts
 * import { file } from 'bun'
 * app.get('/_/{path...}', staticHandler(fs, true))
 * ```
 */
export function staticHandler(
  _fsys: unknown,
  _indexFallback: boolean,
) {
  return async (ctx: {
    params: Record<string, string>
    set: { status?: number }
    request: Request
  }) => {
    // TODO: implement file serving from fsys
    ctx.set.status = 501
    return { message: 'Static file serving not yet implemented.', code: 501 }
  }
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { cors } from './middlewares_cors'
export { bodyLimit, DEFAULT_MAX_BODY_SIZE } from './middlewares_body_limit'
export {
  requireAuth,
  requireSuperuserAuth,
  requireSuperuserOrOwnerAuth,
  requireSameCollectionContextAuth,
  requireGuestOnly,
  loadAuthToken,
  securityHeaders,
  wwwRedirect,
} from './middlewares'
