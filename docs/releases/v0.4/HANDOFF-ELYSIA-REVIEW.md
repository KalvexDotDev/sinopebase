# Sinopebase — Elysia + Better Auth + Security Handoff

Written: 2026-07-28
Source: Multi-agent review against 20 Elysia rules (sinopebase-elysia-rules.md) + Better Auth integration patterns + security audit
Result: **77 findings** — 5 CRITICAL, 27 HIGH, 27 MEDIUM, 18 LOW
Semgrep: 10 new rules added to `.semgrep.yml` for CI enforcement

---

## Fix Order

Fix CRITICALs first (they block correct runtime behavior), then HIGHs grouped by file ownership to avoid merge conflicts, then MEDIUMs, then LOWs.

---

## 🔴 CRITICAL (5)

### C1 — app.ts:896: 7 broken method chains lose all lifecycle hooks + types

**Impact:** Each `server.xxx()` chain starts from the bare `new Elysia()` type. None of the 7 chains inherit hooks from each other. TypeScript cannot infer the combined type. Security headers, error handling, logging, and rate limiting only apply to routes in the specific chain where they were registered — not to PostgREST, Storage, Admin UI, plugins, or backups.

**Fix:** Merge into one continuous chain with reassignment for helper functions:

```typescript
// BEFORE (broken — 7 separate chains from `server`)
const server = new Elysia()
server.onError(...).onRequest(...)                   // Chain 1 — discarded
server.onRequest(...).onAfterResponse(...)           // Chain 2 — discarded
server.onRequest(...).get(...).get(...).ws(...)...   // Chain 3 — discarded
server.use(createStoragePlugin(...))                 // Chain 4 — discarded
this.mountAdminUI(server)                            // Chain 5 — uses bare server
server.get(...).post(...).post(...)                  // Chain 6 — discarded
server.onError(...)                                  // Chain 7 — discarded

// AFTER (single chain + reassign for helpers)
let server = new Elysia({ name: 'sinopebase' })
  .error({ ApiError, BadRequestError, UnauthorizedError, ForbiddenError,
           NotFoundError, TooManyRequestsError, InternalServerError,
           RequestEntityTooLargeError, StorageAccessError, SignedUrlError })
  .onError(panicHandler, { as: 'global' })
  .onRequest(securityHeaders, { as: 'global' })
  .onRequest(requestIdHook, { as: 'global' })
  .onAfterResponse(responseLogging, { as: 'global' })
  .onRequest(rateLimitHook, { as: 'global' })
  .get('/api/health', healthHandler)
  .get('/api/ready', readyHandler)
  .ws('/realtime/v1/websocket', wsHandler)
  .use(this.auth ? createAuthPlugin(this.auth) : authPlugin)
  .onRequest(authGuard)
  .onError(stub501Handler)

// Helpers return Elysia so caller can chain
server = mountPostgrestRoutes(server, this.database, ctxResolver, realtime)
server.use(createStoragePlugin(...))
server = this.mountAdminUI(server)
server = server.get('/api/admin/backups', ...).post(...).post(...)
server = await mastraPlugin.register(server, ...)
server = await new MetricsPlugin().register(server)
for (const register of this.pendingPlugins) {
  server = await register(server, this.auth ?? undefined)
}
this.server = server
```

**Files:** `src/core/app.ts` (lines 896-1223), all helper functions that take `Elysia` parameter must return `Elysia`.

### C2 — app.ts:900: onError doesn't handle VALIDATION

**Impact:** All schema validation failures become generic 500 "Internal server error" instead of useful 422 responses with field-level errors.

**Fix:** Add VALIDATION branch before the generic fallback:

```typescript
.onError(({ error, set, code }) => {
  if (code === 'NOT_FOUND') return
  if (code === 'VALIDATION') {
    set.status = 422
    return process.env.NODE_ENV === 'production'
      ? { message: 'Validation failed', code: 'VALIDATION' }
      : error
  }
  if (error instanceof ApiError) { ... }
  // ...
})
```

**File:** `src/core/app.ts:900`

### C3 — signed-url.ts:151: SignedUrlError missing `status` property

**Impact:** Throwing SignedUrlError produces 500 instead of 400.

**Fix:**
```typescript
export class SignedUrlError extends Error {
  readonly status: number = 400
  constructor(message: string) {
    super(message)
    this.name = 'SignedUrlError'
  }
}
```

**File:** `src/apis/signed-url.ts:151`

### C4 — app.ts:896: No `name` on main server instance

**Impact:** If Sinopebase is ever `.use()`-d as a sub-app, routes/hooks register twice.

**Fix:** `new Elysia({ name: 'sinopebase' })`

### C5 — app.ts:896: No CORS middleware wired

**Impact:** Browser-based Supabase SDK clients get no `Access-Control-Allow-Origin` headers. Cross-origin requests silently fail.

**Fix:** Import `cors()` and wire it before any routes:
```typescript
import { cors } from '../apis/middlewares_cors'
server.onRequest(cors({
  allowOrigins: [...trustedOrigins, ...(config.extraOrigins ?? [])],
  allowCredentials: true,
}))
```

**Files:** `src/core/app.ts:896`, `src/tools/auth-better/index.ts:70-73` (align trustedOrigins)

---

## 🟠 HIGH (27) — Grouped by Owner File

### Owner: `src/core/app.ts`

#### H1 — app.ts:921-926: Security headers not global
**Fix:** `server.onRequest(securityHeadersFn, { as: 'global' })`

#### H2 — app.ts:931-953: Request ID + logging not global
**Fix:** Add `{ as: 'global' }` to both `.onRequest` and `.onAfterResponse`

#### H3 — app.ts:958: Rate limiting not global
**Fix:** `.onRequest(rateLimitHandler, { as: 'global' })`

#### H4 — app.ts:900: Error handler not global
**Fix:** `.onError(panicHandler, { as: 'global' })`

#### H5 — app.ts:1190: Stub 501 onError dead code (registered after all routes)
**Fix:** Move to before line 965 OR merge into the global onError at line 900

#### H6 — app.ts:911: ApiError.toJSON() may leak `data` field in production
**Fix:** Strip `data` for 5xx errors in production mode

#### H7 — app.ts:900: No custom error classes registered via `.error()`
**Fix:** Register all: `.error({ ApiError, BadRequestError, ... })` on the server instance

#### H8 — app.ts:777-779: Secrets written back to process.env
**Fix:** Remove lines 777-779. Refactor `auth-jwt.ts` and `signed-url.ts` to accept secret as parameter.

#### H9 — app.ts:1088: Admin UI at `/_/` no auth guard
**Fix:** Add auth middleware to `mountAdminUI()`. Dev mode: allow with warning log.

#### H10 — app.ts:965: Health endpoint leaks infrastructure details
**Fix:** In production, return only `{ code: 200, message: 'running' }`

#### H11 — app.ts:1021: Service role key no audit logging
**Fix:** Log structured audit event per service_role operation

#### H12 — app.ts:1028: Anon key allows GET on tables without RLS guarantee
**Fix:** Server-side check rejecting tables lacking RLS policies when role is 'anon'

#### H13 — app.ts:708: Inconsistent production mode detection
**Fix:** Use `detectMode()` consistently for all production checks

#### H14 — app.ts:1263: Backup restore path traversal
**Fix:** Sanitize backup name to alphanumeric + hyphens/underscores only

#### H15 — app.ts:1167: OPENAI_API_KEY in config snapshots
**Fix:** Remove from validated config return value; read directly in Mastra plugin

### Owner: `src/apis/postgrest.ts`

#### H16-H20 — postgrest.ts:102,177,198,261,312: 5 handlers use `(ctx)` instead of destructured params
**Fix:** Change each to e.g. `async ({ params, query, headers, body, set, request }) =>`

#### H21 — postgrest.ts:384,551,571,574: Raw `throw new Error()` in route handlers
**Fix:** Replace with `throw new UnauthorizedError(...)`, `throw new NotFoundError(...)`, etc.

### Owner: `src/apis/auth.ts`

#### H22 — auth.ts:298: Better Auth never `.mount()`-ed
**Fix:** Add `server.mount('/api/auth', auth.handler)` alongside the bridge plugin

#### H23 — auth.ts:336: Refresh token rotation lacks family-based replay detection
**Fix:** Use `auth.api.refreshSession()` instead of manual DB update

### Owner: `src/apis/base.ts`

#### H24 — base.ts:93: 7 broken chains in NewRouter + api sub-group
**Fix:** Same pattern as C1 — merge into continuous chains, make helpers return Elysia

### Owner: `src/apis/middlewares_rate_limit.ts`

#### H25 — middlewares_rate_limit.ts:255: X-Forwarded-For not validated against trusted proxies
**Fix:** Pass `trustedProxies` to rateLimit(), only trust X-Forwarded-For from trusted peers

### Owner: `src/apis/signed-url.ts`

#### H26 — signed-url.ts:32: Signed URL HMAC reuses JWT_SECRET
**Fix:** Introduce dedicated `SIGNED_URL_SECRET` or derive via HKDF from JWT_SECRET

### Owner: `src/apis/middlewares_cors.ts` + `src/core/app.ts`

#### H27 — No CORS wired (duplicate of C5 but cross-file)
**Fix:** Same as C5 above

---

## 🟡 MEDIUM (27) — Summary

### Missing `name` on Elysia instances (13 sites)
| File | Instance | Suggested Name |
|---|---|---|
| `apis/auth.ts:60` | `authPlugin` | `sinopebase-auth-fallback` |
| `apis/auth.ts:298` | `createAuthPlugin()` | `sinopebase-auth` |
| `apis/file.ts:109` | `createStoragePlugin()` | `sinopebase-storage` |
| `plugins/mastra/plugin.ts:145` | `agentRoutes` | `sinopebase-mastra-agents` |
| `plugins/mastra/routes/chat.ts:14` | `createChatRoutes()` | `sinopebase-mastra-chat` |
| `plugins/mastra/routes/embeddings.ts:12` | `createEmbeddingsRoutes()` | `sinopebase-mastra-embeddings` |
| `plugins/drop-functions/routes/manage.ts:38` | `createManageRoutes()` | `sinopebase-drop-fn-manage` |
| `plugins/drop-functions/routes/execute.ts:31` | `createExecuteRoutes()` | `sinopebase-drop-fn-execute` |
| `apis/settings.ts:73` | `createSettingsPlugin()` | `sinopebase-settings` |
| `apis/record_crud.ts:172` | record CRUD plugin | `sinopebase-record-crud` |
| `apis/record_auth.ts:169` | record auth plugin | `sinopebase-record-auth` |
| `apis/collection.ts:78` | collection plugin | `sinopebase-collection` |
| `apis/batch.ts:43` | batch plugin | `sinopebase-batch` |

### Broken chains in void-return helpers
- `middlewares.ts:513` — `registerDefaultMiddleware` returns void → return Elysia
- `middlewares.ts:528` — `registerActivityLogger` returns void → return Elysia
- `app.ts:1416` — `mountAdminUI` returns void → return Elysia (or `this`)

### Type inference / JIT
- `app.ts:961` — rate limiter passes `{ request, set }` object to sub-function → pass as separate args or inline
- `metrics/plugin.ts:25` — explicit `MetricsContext` type annotation blocks JIT inference → remove annotation, destructure

### Error handling gaps
- `api_error_aliases.ts:105` — `toApiError()` embeds stack traces in `data` field → sanitize in production
- `storage-postgres.ts:383` — `StorageAccessError` extends Error not ApiError → onError won't catch it → make extend ApiError
- `app.ts:914` — stack trace logged unconditionally in onError → gate behind dev mode
- `middlewares.ts:475` — `panicRecover` logs stack unconditionally → gate behind dev mode
- `auth.ts:68` — manual inline validation instead of Elysia schema `t.Object` → adopt schema validation

### Better Auth
- `auth.ts:60` — auth uses onRequest middleware instead of macro pattern for typed session → define macro for sub-routes
- `auth-better/index.ts:70` — trustedOrigins restricted to localhost, Serve path CORS is `*` → align both from single config source
- `auth-better/index.ts:104` — `basePath` not explicitly configured → add `basePath: '/api/auth'`

### Security
- `auth-better/index.ts:68` — JWT dev fallback duplicated across 5 files with inconsistent values → export shared constant
- `app.ts:1021` — service role key comparison uses `===` → use `Equal()` from `crypto.ts`
- `app.ts:921` — no CSP or HSTS headers → add CSP `frame-ancestors 'none'` + HSTS when TLS enabled
- `security/jwt.ts:20` — `TextEncoder` for key encoding → use `Buffer.from(key, 'utf-8')`

---

## 🟢 LOW (18) — Summary

### Remaining unnamed instances (7 latent code-path plugins)
`apis/logs.ts:47`, `apis/health.ts:21`, `apis/cron.ts:45`, `apis/collection_import.ts:38`, `apis/backup.ts:47` — add `name` to each.

### Documentation + hardening
- `app.ts:1009` — auth guard correctly instance-scoped but lacks doc comment → add rationale
- `base.ts:128` — `name: 'api'` too generic → rename to `'sinopebase-api'`
- `collection.ts:82` — `set.status = 403; return {...}` instead of `throw new ForbiddenError()` → use throw for consistency
- `extensions.ts:28` — CSP allows scripts from any localhost port → lock to specific ports

---

## Semgrep Enforcement (added to `.semgrep.yml`)

These 10 rules catch the mechanical violations in CI Stage 2:

| Rule | Severity | Catches |
|---|---|---|
| `elysia-broken-chaining` | ERROR | Assign-then-chain on Elysia instances |
| `security-env-writeback-secrets` | ERROR | `process.env.JWT_SECRET = ...` pattern |
| `elysia-unsafe-validation-details` | ERROR | `allowUnsafeValidationDetails = true` |
| `elysia-unnamed-instance` | WARNING | `new Elysia()` without `name` |
| `elysia-no-handler-destructure` | WARNING | `(ctx) =>` in route handlers |
| `elysia-custom-error-no-status` | WARNING | Error class without `status` property |
| `elysia-unregistered-error-class` | WARNING | `throw new ApiError` without `.error()` registration |
| `elysia-raw-error-throw-in-handler` | WARNING | `throw new Error()` in route files |
| `elysia-wildcard-cors` | WARNING | `allowOrigins: ['*']` |
| `security-jwt-fallback-duplicated` | WARNING | Duplicated dev fallback string |
| `security-health-endpoint-leak` | WARNING | Health endpoint exposing infra details |

---

## Verification

After each fix wave, run:
```powershell
bun run build              # Must pass
bun run test:component      # 48 tests must pass
bun run test:compatibility  # 49 tests must pass
bun test                    # 1229 tests must pass
bun run typecheck           # 0 new errors
bun run lint                # Biome clean
semgrep --config .semgrep.yml src/ tests/  # 0 findings from new rules
```

---

## See Also
- [[sinopebase-elysia-rules]] — full 20-rule reference with examples
- [[sinopebase-v0.4-production-readiness]] — Wave 1 security workstreams
- `docs/releases/v0.4/HANDOFF.md` — previous handoff (Wave 0 complete)
