/**
 * PocketBase-compatible middleware ported to Elysia hooks/guards.
 *
 * Port of PocketBase apis/middlewares.go
 * Layer 4 — imports from ~/core/*, ~/tools/*.
 *
 * Provides:
 * - requireAuth / requireSuperuserAuth / requireSuperuserOrOwnerAuth
 * - requireSameCollectionContextAuth / requireGuestOnly
 * - loadAuthToken
 * - activityLogger
 * - securityHeaders
 * - panicRecover
 * - wwwRedirect
 *
 * Each factory returns an Elysia `onRequest` (or `beforeHandle`) hook.
 */

import type { Context, Elysia, PreContext } from 'elysia'
import { ApiError, BadRequestError, ForbiddenError, UnauthorizedError } from './api_error_aliases'
import { verifyAccessToken } from './auth-jwt'

// ---------------------------------------------------------------------------
// Store keys
// ---------------------------------------------------------------------------

/** Key used in request store to pass extra log metadata. */
export const REQUEST_EVENT_KEY_LOG_META = 'pbLogMeta'

/** Key to skip successful activity log entries. */
export const REQUEST_EVENT_KEY_SKIP_SUCCESS_LOG = '__skipSuccessActivityLogger'

/** Key for exec start timestamp. */
export const REQUEST_EVENT_KEY_EXEC_START = '__execStart'

// ---------------------------------------------------------------------------
// Default middleware IDs & priorities (for reference — Elysia doesn't
// use these directly, but they document the ordering intent).
// ---------------------------------------------------------------------------

export const DEFAULT_WWW_REDIRECT_PRIORITY = -99999
export const DEFAULT_ACTIVITY_LOGGER_PRIORITY = -1040
export const DEFAULT_PANIC_RECOVER_PRIORITY = -1030
export const DEFAULT_LOAD_AUTH_TOKEN_PRIORITY = -1020
export const DEFAULT_SECURITY_HEADERS_PRIORITY = -1010
export const DEFAULT_RATE_LIMIT_PRIORITY = -1000

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

const SuperusersCollectionName = '_superusers'

type AuthPayload = Awaited<ReturnType<typeof verifyAccessToken>> &
  Partial<Record<'collection' | 'collectionId' | 'id', string>>

interface MiddlewareError {
  readonly message?: string
  readonly stack?: string
}

function asAuthPayload(payload: Awaited<ReturnType<typeof verifyAccessToken>>): AuthPayload {
  return payload as AuthPayload
}

/**
 * Extract the Bearer token from the Authorization header.
 *
 * PocketBase does not require the "Bearer " prefix — the raw token value
 * is also accepted for compatibility.
 */
function getAuthTokenFromRequest(request: Request): string {
  const auth = request.headers.get('authorization') ?? ''
  if (auth.length > 7 && auth.slice(0, 7).toLowerCase() === 'bearer ') {
    return auth.slice(7)
  }
  return auth
}

// ---------------------------------------------------------------------------
// Auth middlewares
// ---------------------------------------------------------------------------

/**
 * Validates a Bearer JWT and sets the auth context.
 * Returns 401 if the token is invalid or missing.
 *
 * Can be narrowed to specific auth collections by passing collection names.
 *
 * @example
 * ```ts
 * app.onRequest(requireAuth())           // any auth collection
 * app.onRequest(requireAuth('_superusers', 'users'))
 * ```
 */
export function requireAuth(...optCollectionNames: string[]) {
  return async (ctx: {
    request: Request
    set: { status?: number }
    store: Record<string, unknown>
  }): Promise<void> => {
    const token = getAuthTokenFromRequest(ctx.request)
    if (!token) {
      throw new UnauthorizedError('The request requires valid record authorization token.')
    }

    try {
      const payload = asAuthPayload(await verifyAccessToken(token))

      // Store the decoded token payload so downstream handlers can read auth context
      ctx.store.auth = payload

      // Check collection name if specified
      if (optCollectionNames.length > 0) {
        const coll = (payload.collection as string) ?? (payload.collectionId as string) ?? ''
        if (!optCollectionNames.includes(coll)) {
          throw new ForbiddenError('The authorized record is not allowed to perform this action.')
        }
      }
    } catch (err) {
      if (err instanceof ApiError) throw err
      throw new UnauthorizedError('The request requires valid record authorization token.')
    }
  }
}

/**
 * Validates that the request carries a superuser auth token.
 * Returns 401 if the token is missing or not a superuser.
 */
export function requireSuperuserAuth() {
  return requireAuth(SuperusersCollectionName)
}

/**
 * Validates a superuser token or a regular record token whose id matches
 * the `ownerIdPathParam` route parameter (default `"id"`).
 *
 * Superusers always pass. Regular records must own the resource.
 */
export function requireSuperuserOrOwnerAuth(ownerIdPathParam = 'id') {
  return async (ctx: {
    request: Request
    params: Record<string, string>
    set: { status?: number }
    store: Record<string, unknown>
  }): Promise<void> => {
    const token = getAuthTokenFromRequest(ctx.request)
    if (!token) {
      throw new UnauthorizedError('The request requires superuser or record authorization token.')
    }

    try {
      const payload = asAuthPayload(await verifyAccessToken(token))
      ctx.store.auth = payload

      const coll = (payload.collection as string) ?? ''
      if (coll === SuperusersCollectionName) {
        return // superuser — always allowed
      }

      const ownerId = ctx.params[ownerIdPathParam]
      const recordId = payload.id as string | undefined
      if (!recordId || recordId !== ownerId) {
        throw new ForbiddenError('You are not allowed to perform this request.')
      }
    } catch (err) {
      if (err instanceof ApiError) throw err
      throw new UnauthorizedError('The request requires superuser or record authorization token.')
    }
  }
}

/**
 * Validates that the auth record belongs to the same collection referenced
 * by the route path parameter `collectionParam` (default `"collection"`).
 */
export function requireSameCollectionContextAuth(collectionParam = 'collection') {
  return async (ctx: {
    request: Request
    params: Record<string, string>
    set: { status?: number }
    store: Record<string, unknown>
  }): Promise<void> => {
    const token = getAuthTokenFromRequest(ctx.request)
    if (!token) {
      throw new UnauthorizedError('The request requires valid record authorization token.')
    }

    try {
      const payload = asAuthPayload(await verifyAccessToken(token))
      ctx.store.auth = payload

      const tokenCollectionId = (payload.collectionId as string) ?? ''

      // The collection param in the route — for now trust it's the collectionId
      // In PocketBase this resolves FindCachedCollectionByNameOrId
      const routeCollection = ctx.params[collectionParam] ?? ''

      if (tokenCollectionId !== routeCollection) {
        throw new ForbiddenError(
          `The request requires auth record from ${payload.collection ?? 'the specified'} collection.`,
        )
      }
    } catch (err) {
      if (err instanceof ApiError) throw err
      throw new UnauthorizedError('The request requires valid record authorization token.')
    }
  }
}

/**
 * Rejects the request if the caller is already authenticated.
 * Returns 403.
 */
export function requireGuestOnly() {
  return async (ctx: { request: Request; store: Record<string, unknown> }): Promise<void> => {
    const token = getAuthTokenFromRequest(ctx.request)
    if (token) {
      try {
        await verifyAccessToken(token)
        throw new BadRequestError('The request can be accessed only by guests.')
      } catch (err) {
        if (err instanceof BadRequestError) throw err
        // Token invalid — guest is fine, pass through
      }
    }
  }
}

// ---------------------------------------------------------------------------
// loadAuthToken — parse Authorization header, verify JWT, populate store
// ---------------------------------------------------------------------------

/**
 * Parses the Authorization header, verifies the JWT, and populates
 * `ctx.store.auth` with the decoded payload.
 *
 * If the token is missing, invalid, or expired the middleware silently
 * continues — it does NOT reject the request. This allows downstream
 * handlers and middleware to implement their own auth strategy.
 *
 * This middleware is registered by default for all routes.
 */
export function loadAuthToken() {
  return async (ctx: Pick<PreContext, 'request' | 'store'>): Promise<void> => {
    const store = ctx.store as Record<string, unknown>

    // Already loaded by another middleware
    if (store.auth != null) return

    const token = getAuthTokenFromRequest(ctx.request)
    if (!token) return

    try {
      const payload = await verifyAccessToken(token)
      store.auth = payload
    } catch {
      // Silently ignore — invalid/expired token
    }
  }
}

/**
 * Drop-in for loadAuthToken() that resolves the token via a Better Auth
 * server instance instead of local JWT decoding.
 *
 * Calls `auth.api.getSession()` with the bearer token and populates
 * `ctx.store.auth` with a shape compatible with `requireAuth()`:
 * `{ id, email, collection, collectionId, role }`.
 *
 * If the token is missing or invalid the middleware silently continues,
 * exactly like `loadAuthToken()`.
 */
interface BetterAuthForMiddleware {
  api: {
    getSession(args: {
      headers: Headers
    }): Promise<{ user?: { id?: string; email?: string; role?: string } } | null>
  }
  [key: string]: unknown
}

export function loadAuthTokenWithBetterAuth(auth: BetterAuthForMiddleware) {
  return async (ctx: { request: Request; store: Record<string, unknown> }): Promise<void> => {
    if (ctx.store.auth != null) return
    const authHeader = ctx.request.headers.get('authorization') ?? ''
    const token =
      authHeader.length > 7 && authHeader.slice(0, 7).toLowerCase() === 'bearer '
        ? authHeader.slice(7)
        : authHeader
    if (!token) return
    try {
      const result = await auth.api.getSession({
        headers: new Headers({ authorization: `Bearer ${token}` }),
      })
      if (result?.user) {
        // Map better-auth user to PocketBase auth store shape.
        // better-auth has no "collection" concept — we derive it from role.
        const role: string = result.user.role || 'authenticated'
        const isSuperuser = role === 'superuser' || role === 'admin'
        ctx.store.auth = {
          id: result.user.id,
          email: result.user.email,
          collection: isSuperuser ? '_superusers' : role,
          collectionId: isSuperuser ? '_superusers' : role,
          role,
        }
      }
    } catch {
      // Silently ignore invalid tokens
    }
  }
}

// ---------------------------------------------------------------------------
// activityLogger — log API requests
// ---------------------------------------------------------------------------

/**
 * Logs API request information (method, URL, status, duration, auth info)
 * using the console logger.
 *
 * Skips logging if the `skipSuccessActivityLog` store key is set and the
 * request succeeded.
 *
 * @deprecated Use `activityLoggerStart()` / `activityLoggerEnd()` /
 * `activityLoggerError()` instead. These three hooks are registered
 * together by `registerActivityLogger()`.
 */
export function activityLogger() {
  return activityLoggerStart()
}

/**
 * Registers the pair of hooks that implement activity logging:
 * - onRequest: records the start time
 * - onAfterHandle / onError: logs the request outcome
 *
 * Call this once in your router setup:
 * ```ts
 * app.onRequest(activityLoggerStart())
 * app.onAfterHandle(activityLoggerEnd())
 * app.onError(activityLoggerError())
 * ```
 */
export function activityLoggerStart() {
  return (ctx: Pick<PreContext, 'store'>): void => {
    const store = ctx.store as Record<string, unknown>
    store[REQUEST_EVENT_KEY_EXEC_START] = Date.now()
  }
}

export function activityLoggerEnd() {
  return (ctx: Pick<Context, 'request' | 'set' | 'store'> & { response: unknown }): void => {
    logRequest(ctx, null)
  }
}

export function activityLoggerError() {
  return (ctx: { request: Request; set: Context['set']; store: object; error: unknown }): void => {
    logRequest(ctx, ctx.error)
  }
}

function logRequest(
  ctx: {
    request: Request
    set?: Context['set']
    store: object
  },
  err: unknown | null,
): void {
  const store = ctx.store as Record<string, unknown>
  const start = store[REQUEST_EVENT_KEY_EXEC_START] as number | undefined
  const execTime = start != null ? Date.now() - start : 0

  // Check if success logging is disabled
  if (!err && store[REQUEST_EVENT_KEY_SKIP_SUCCESS_LOG] != null) return

  const method = ctx.request.method.toUpperCase().slice(0, 50)
  const url = ctx.request.url.slice(0, 3000)
  const status = ctx.set?.status ?? (err ? 500 : 200)

  const meta: Record<string, unknown> = {}
  if (execTime > 0) meta.execTime = execTime

  const auth = store.auth as Record<string, unknown> | undefined
  if (auth) {
    meta.authCollection = auth.collection ?? ''
    meta.authId = auth.id ?? ''
  }

  const logData: Record<string, unknown> = {
    type: 'request',
    method,
    url,
    status,
    auth: auth ? (auth.collection ?? '') : '',
    execTime,
  }

  if (err) {
    const error = err as MiddlewareError
    logData.error = error.message
    console.error(`[API] ${method} ${url} ${status} ${execTime}ms`, logData)
  } else {
    console.log(`[API] ${method} ${url} ${status} ${execTime}ms`, logData)
  }
}

// ---------------------------------------------------------------------------
// securityHeaders — CORS, HSTS, CSP, X-Content-Type-Options, etc.
// ---------------------------------------------------------------------------

/**
 * Adds common security headers to every response.
 *
 * Headers set:
 * - `X-XSS-Protection: 1; mode=block`
 * - `X-Content-Type-Options: nosniff`
 * - `X-Frame-Options: SAMEORIGIN`
 *
 * Additional security headers (CSP) are configured via the CORS middleware
 * and the serve layer.
 */
export function securityHeaders() {
  return (ctx: Pick<PreContext, 'set'>): void => {
    ctx.set.headers['x-xss-protection'] = '1; mode=block'
    ctx.set.headers['x-content-type-options'] = 'nosniff'
    ctx.set.headers['x-frame-options'] = 'SAMEORIGIN'
  }
}

// ---------------------------------------------------------------------------
// wwwRedirect — www -> non-www redirect
// ---------------------------------------------------------------------------

/**
 * Performs 307 redirect from www to non-www for the given host list.
 *
 * Example:
 * ```ts
 * app.onRequest(wwwRedirect(['www.example.com']))
 * ```
 */
export function wwwRedirect(redirectHosts: string[]) {
  return (ctx: Pick<PreContext, 'request' | 'set'>): void => {
    const host = ctx.request.headers.get('host') ?? ''

    if (host.startsWith('www.') && redirectHosts.includes(host)) {
      const scheme =
        host.includes('https') || ctx.request.url.startsWith('https') ? 'https://' : 'http://'
      const url = new URL(ctx.request.url)
      ctx.set.redirect = `${scheme}${host.slice(4)}${url.pathname}${url.search}`
      ctx.set.status = 307
    }
  }
}

// ---------------------------------------------------------------------------
// panicRecover — recover from unhandled errors
// ---------------------------------------------------------------------------

/**
 * Catches unhandled exceptions in the request pipeline and returns a 500
 * response instead of crashing the process.
 *
 * Register this as the outermost onError handler.
 */
export function panicRecover() {
  return (ctx: { set: Context['set']; error: unknown }): void => {
    const error = ctx.error as MiddlewareError
    const stack = error.stack ?? ''
    console.error(`[PANIC RECOVER] ${error.message}`, stack.slice(0, 2048))

    ctx.set.status = 500
  }
}

// ---------------------------------------------------------------------------
// SkipSuccessActivityLog
// ---------------------------------------------------------------------------

/**
 * Helper middleware that instructs the activity logger to log only
 * requests that have failed/returned an error.
 */
export function skipSuccessActivityLog() {
  return (ctx: { store: Record<string, unknown> }): void => {
    ctx.store[REQUEST_EVENT_KEY_SKIP_SUCCESS_LOG] = true
  }
}

// ---------------------------------------------------------------------------
// Convenience: register all default middleware on an Elysia app
// ---------------------------------------------------------------------------

/**
 * Register the default PocketBase middleware stack on an Elysia app.
 *
 * Order (outermost → innermost):
 * 1. panicRecover
 * 2. rateLimit
 * 3. wwwRedirect
 * 4. activityLogger (start)
 * 5. loadAuthToken
 * 6. securityHeaders
 * 7. bodyLimit
 *
 * The activity logger end hooks and error handler are registered separately.
 */
export function registerDefaultMiddleware(app: Elysia): void {
  app
    .onError(panicRecover())
    .onRequest(securityHeaders())
    .onRequest(loadAuthToken())
    .onRequest(activityLoggerStart())
  // The following are registered on specific route groups, not globally
  // .onRequest(rateLimit(...)) — per-group
  // .onRequest(bodyLimit(...)) — per-group
}

/**
 * Register the activity logger end hooks on an app.
 * Call this after all routes are defined.
 */
export function registerActivityLogger(app: Elysia): void {
  app.onAfterHandle(activityLoggerEnd()).onError(activityLoggerError())
}
