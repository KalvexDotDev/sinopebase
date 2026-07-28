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
  loadAuthToken,
  registerActivityLogger,
  registerDefaultMiddleware,
  securityHeaders,
  wwwRedirect,
} from './middlewares'
import { bodyLimit, DEFAULT_MAX_BODY_SIZE } from './middlewares_body_limit'
import { type CORSConfig, cors } from './middlewares_cors'
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
export async function NewRouter(app: App, options: RouterOptions = {}): Promise<Elysia> {
  const logger = new ConsoleLogger()

  const applyCors = cors(options.corsConfig ?? { allowOrigins: ['*'] })

  // ponytail: const chain avoids Elysia type reconciliation issues.
  // Each const captures the full inferred type from the chain expression.
  const router0 = new Elysia({ name: 'sinopebase' })
    .state('app', app)
    .state('logger', logger)
    .state('store', new Store<string, unknown>())
    .onRequest(({ request, set }) =>
      applyCors({
        request,
        set: set as Parameters<typeof applyCors>[0]['set'],
      }),
    )

  // ── Gzip compression ──
  configureGzip()

  // ── WWW redirect ──
  const router1 =
    options.wwwRedirectHosts && options.wwwRedirectHosts.length > 0
      ? router0.onRequest(wwwRedirect(options.wwwRedirectHosts))
      : router0

  // ── Default middleware stack ──
  // ponytail: cast to broad Elysia — helpers were authored before chain types were enriched
  const router2 = registerDefaultMiddleware(router1 as unknown as Elysia)

  // ── API group: /api ──
  const api = new Elysia({ prefix: '/api', name: 'sinopebase-api' })

  // Per-group middleware
  api.onRequest(loadAuthToken())
  api.onRequest(securityHeaders())
  api.onRequest(bodyLimit(options.maxBodySize ?? DEFAULT_MAX_BODY_SIZE))

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
  const router3 = router2.use(api)

  // ── Activity logger (end hooks) ──
  const router4 = registerActivityLogger(router3)

  // ── Catch-all: 501 for unimplemented routes ──
  const router5 = router4.all('/api/*', ({ set }) => {
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

  // ponytail: cast to declared return type — chain types are richer than the broad Elysia
  // interface, but callers only need the standard Elysia surface.
  return router5 as unknown as Elysia
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
export function staticHandler(_fsys: unknown, _indexFallback: boolean) {
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

export {
  loadAuthToken,
  requireAuth,
  requireGuestOnly,
  requireSameCollectionContextAuth,
  requireSuperuserAuth,
  requireSuperuserOrOwnerAuth,
  securityHeaders,
  wwwRedirect,
} from './middlewares'
export { bodyLimit, DEFAULT_MAX_BODY_SIZE } from './middlewares_body_limit'
export { cors } from './middlewares_cors'
