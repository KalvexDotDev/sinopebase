# Changelog

## v0.8.4 — 2026-08-18

### Fixed
- **CORS preflight routing** — all allowed, rejected, and origin-less `OPTIONS` requests now return an explicit empty `204` response instead of falling through to route handling as `501`.
- **Configurable browser origins** — `SINOPEBASE_EXTRA_ORIGINS` is parsed as a trimmed comma-separated list and passed into the server's trusted CORS and OAuth origins.
- **SSR cookie adapter compatibility** — the workspace SDK and published `@sinopebase/sdk` now pass cookie attributes under the SvelteKit-compatible `options` property instead of `opts`.
- **Signed browser sessions** — `/auth/v1/session`, `/api/auth/exchange`, and authorization-code token exchange now ask Better Auth to validate signed session cookies before using the backing session token; tampered cookies are rejected consistently.

## v0.8.3 — 2026-08-16

### Added
- **Factory schema** — migration-backed `f_*` tables and `factory_*` RPC functions, with integration coverage for the factory API surface.
- **Distributable SDK package** — `sdk-package` now builds bundled JavaScript and declarations into `dist/` for npm publishing.

### Fixed
- **Realtime RLS delivery** — realtime joins send the current access token and auth changes propagate through `realtime.setAuth()`, so `postgres_changes` events reach authenticated subscribers under RLS.
- **PostgREST PostgreSQL errors** — database errors preserve compatible 4xx response codes instead of being masked as 500s.
- **Compiled migrations** — migrations resolve beside the compiled binary and are included in the Docker image.
- **Release npm job** — installs Bun and frozen dependencies before building and publishing the SDK.

## v0.8.2 — 2026-08-16

### Fixed
- **Production deploy crash** — the Dockerfile compiled the binary with `--external nodemailer` while the runtime image ships no node_modules, so every v0.8+ production deploy crashed at boot with `Cannot find package 'nodemailer'` (confirmed in Railway logs). nodemailer is now bundled.
- **Railway platform healthcheck** — Railway's default probe hits `GET /railway`; the route now returns `{status:'ok'}` and is rate-limit exempt, with a deploy-health test suite (probe contract, exemption, sustained probe loop).
- **Least-privilege roles heal at startup** — production databases provisioned before the migration (observed on Railway: roles 3/5) now get the `1779000000` migration applied idempotently at startup instead of running with weaker roles.
- **Docker HEALTHCHECK port** — respects `PORT` (Railway injects 8080) instead of hardcoding 8090.
- **Release workflow** — `npm version` tolerates an already-bumped SDK version (`--allow-same-version`) and the workflow supports manual dispatch.
- **Test harness port sharing** — on macOS `exclusive` is a no-op and SO_REUSEADDR let two test apps share one port; reservations now skip ports already handed out by the process.

## v0.8.1 — 2026-08-15

### Added
- **SDK root-level `rpc()`** — `client.rpc(fn, args, options)` matches the supabase-js contract: rows by default, single value with `{ get: true }`, status only with `{ head: true }`. Sends the signed-in session token so RLS resolves the user's role (previously `rpc()` hung only off `from()` and always used the API key).
- **Anon RPC access** — `/rest/v1/rpc/*` POSTs with the anon key now reach PostgREST, matching Supabase (RLS policies still gate the data).
- **Custom metric registration** — `app.metrics.registerMetric(name, help, 'counter' | 'gauge')` publishes consumer metrics on `/metrics` (Prometheus) and `/api/metrics` (JSON). Names are validated against the Prometheus metric-name pattern.
- **SDK session-token auth for queries** — `from()` requests send the current session token instead of the hardcoded API key, so table queries honor RLS for signed-in users.

### Fixed
- **SDK package drift** — `sdk-package/src` (the npm publish source) had fallen behind `src/sdk`; synced so `@sinopebase/sdk` publishes the current client.
- **Version fields** — repository and SDK package `package.json` versions were stale (0.6.2); aligned to 0.8.0 to match master content and the next release tag.

## v0.7.0 — 2026-08-03

### Added
- **OAuth clientSecret encryption at rest** — AES-256-GCM with HKDF key from `JWT_SECRET`, atomic writes, backward-compatible plaintext migration
- **Issuer URL validation** — HTTPS-only, private/loopback IP blocking, `providerId` charset enforcement
- **OAuth session exchange** — `POST /api/auth/exchange` converts better-auth session cookie to Bearer token, enabling production OAuth login for admin UI
- **SDK `signInWithOAuth()`** — constructs provider URL with `redirectTo`, `scopes`, and `queryParams` support
- **SDK heartbeat timer** — sends `phx_heartbeat` every 30s to prevent presence expiry
- **Stateless signed URLs** — removed NonceStore replay detection, tokens are now reusable (Supabase-compatible)
- **Storage content-type inference** — download responses use MIME types from file extension instead of `application/octet-stream`
- **Storage Range support** — RFC 7233 `Range` header, `206 Partial Content` responses, `Accept-Ranges: bytes`
- **PostgREST RPC endpoint** — `POST /rest/v1/rpc/:fn` for PostgreSQL function invocation

### Changed
- Admin UI OAuth login works in production (no longer dev-mode only)
- Admin UI guard accepts valid better-auth sessions alongside service_role keys

### Removed
- 35 legacy PocketBase OAuth provider files (`src/tools/auth/*`) — zero external imports
- Unused `apple_client_secret_create` form
- NonceStore class and replay detection from signed URLs

### Fixed
- SDK `in()` comma-quoting — values containing commas are double-quoted
- Presence hub disposal wired into `app.stopServer()` — prevents interval leak on restart
- `_providersPath` module-level cache removed from admin-oauth

## v0.6.2 — 2026-08-01

### Added
- **Dev-secret gate (production mode only)** — preflight checks for dev secrets only run in production mode, allowing development without false positives
- **CI harness docs** — `ci:quick` gate + pre-push checklist in CLAUDE.md

### Fixed
- TLS test syntax (`test.skip` → correct `test.skip` usage)
- Mastra chat test `mode: 'development'` for CI stability

## v0.6.1 — 2026-08-01

### Added
- **Rate limit default: 1000 req/min** (up from 100). Admin, logs, health, and ready paths exempted.
- **Prefer header for all SDK count values** — `count=planned`/`count=estimated` now set `Prefer: count=...` header
- **Compat matrix** — signed-URL section corrected
- **CHANGELOG** — "25+ providers" claim trimmed to reflect actual built-in + generic OIDC support

### Fixed
- `auth.role()` SQL function provisioned alongside `auth.uid()` — both available in RLS policies
- `parseInValue` now used in both memory + Postgres backends (consistent comma-quoting)
- `parseOrFilters` — proper comma=OR semantics in filter parsing
- README pre-1.0 caveats section updated

## v0.6.0 — 2026-08-01

### Added
- **OAuth — end-to-end** — better-auth `socialProviders` (Google, GitHub, Discord, Apple, Microsoft, Spotify, GitLab) + `genericOAuth` for enterprise OIDC (Keycloak, Okta, Auth0, Entra ID). `issuer` → `discoveryUrl` mapping. `/api/auth/oauth-providers` discovery endpoint. `oauth_providers.json` persistence in `pb_data/`. Admin UI OAuth login buttons + provider CRUD in Settings. `docs/auth.md` corrected provider table.
- **Realtime Presence** — Full Phoenix Presence protocol: `presence_state`, `presence_diff`, `track`, `untrack`. Auth gates on track/untrack (joined-state + authentication required). Heartbeat sweeper (60s timeout, 15s cadence, 5 entries/client/topic cap). Payload size limit. Auto-cleanup on disconnect/phx_leave. SDK: `channel.track(key, data)` / `channel.untrack(key?)`. Supports both supabase-js and SDK shapes.
- **PostgREST Filters** — 10 operators (`eq/neq/gt/gte/lt/lte/like/ilike/is/in`). `neq.null` → `IS NOT NULL`. `or=(...)` wired in PATCH/DELETE (was only GET/HEAD). `and()` wrapper for OR-of-AND groups. Comma-quoting in `in()` filter values. `count=planned/estimated` Prefer header support.
- **Admin UI OAuth Management** — Settings page with provider CRUD, OAuth login buttons on Login page
- **DevOps** — `docker-compose.yml` with sinopebase service, `.env.example` template, GHCR container images (`ghcr.io/kalvexdotdev/sinopebase:v0.6.2` + `:latest`), Railway `referralCode=9TQA5W` on deploy links

### Security Fixes
- Presence track/untrack gated on joined-state + auth
- `isSuperuser` rejects empty service-role key (dev mode bypass fixed)
- Timing-safe `Equal()` for keys in realtime context
- POST redacts `clientSecret` in OAuth CRUD response
- `try/catch` on `decodeURIComponent` for malformed providerId
- Preflight dev-secret checks gated to production mode only

### Changed
- `FilterOperator` type trimmed to 10 implemented operators
- CI: `ci` now uses `typecheck:ci` instead of bare `typecheck`
- CI: `ci:quick` script added (`format:check && lint && typecheck:ci` — fast, no Docker)

## v0.5.0 — 2026-07-30

### Added
- **Admin UI — Supabase Studio parity** — Table Editor (sidebar search, slide-over add, sticky actions, pagination), Auth Users (CRUD, password reset, session view), Storage (bucket browser, upload/download, authenticated download), RLS Policies viewer, API Docs (native OpenAPI via `@elysia/openapi`, Cairn-themed), Realtime Inspector (auto-subscribe, phx_join v2), Backups (create/restore/schedule), Metrics (request rate, latency, errors, DB pool), AI Playground (Mastra Studio-inspired, agent CRUD, 3-panel layout, tool call display)
- **Cairn Design System** — editorial dark SPA, Cormorant Garamond + Inter, single mint accent. Reusable Modal + Button components. Accessible (a11y) interactions.
- **Request logging** — Dozzle-inspired live log viewer with level dots, method colors, path badges, pause/resume, auto-scroll, 30-day retention
- **Cron Jobs** — PostgreSQL-backed CRUD, handler field (fn:name or URL), Run Now execution, admin UI with handler column
- **DropFunctions edge functions** — wired plugin, function execution at `/api/functions/v1/:name`, `hello.ts` test function, Functions page with API route URLs
- **AI Playground v2** — agent CRUD with persistence to `_mastra_agents`, 3-panel layout, tool inspector, chat with tool call display, free-text model input, defaults to deepseek-chat
- **Realtime — PG LISTEN/NOTIFY** — cross-process fan-out with `PgRealtimeListener`, integration test
- **TLS hardening** — Bun-native TLS + LetsEncrypt, admin UI auth guard & API wiring
- **Playwright e2e tests** — admin UI tests + TLS integration test

### Changed
- Table Editor rebuilt with db-ui UX patterns
- Storage: POST for object listing, DELETE with JSON body paths array, RLS enable endpoint
- Admin API auth uses direct token check instead of postgrestContexts
- `@elysia/openapi` wired for native OpenAPI doc generation

## v0.4.0 — 2026-07-29

### Added
- **CI/CD hardening** — 9 quality gates (test, typecheck, lint, build, UI build, Docker, SAST/semgrep, dependency audit, Trivy container scan), all green
- **Railway deploy** — `railway.toml`, `.env.railway`, GitHub Actions CD pipeline, Dockerfile with read-only root + UID 10001 + capability drop
- **Security hardening** — pre-commit Gitleaks, semgrep SAST, Trivy CRITICAL+HIGH gates, HSTS, timing-safe key comparison, hairline auth borders
- **Backup & restore** — SQL-based fallback when pg_dump unavailable, admin UI
- **PostgreSQL RLS** — `SET LOCAL ROLE` in `withRequestContext`, least-privilege role bootstrap, migration-on-startup
- **Biome 2.5** — 0 `any`, 0 non-null assertions, typed codebase

### Fixed
- **P0-4 RLS** — restored `SET LOCAL ROLE` removed during refactoring, per-table GRANTs, transaction-safe role switching
- **P0 config** — dev secret patterns and `isDevSecret` helper
- **P0 storage** — signed URL crypto contract
- **P0 DB** — least-privilege roles migration, remove runtime DDL
- Cookie-based token storage for NextBase adapter
- PostgREST insert array handling + anon key bypass
- CI: MinIO service, PG wait, semgrep YAML, gitleaks config, JUnit reporter

## v0.3.0 — 2026-07-27

### Added
- **Bun Worker isolation** (phase 1) — edge functions in sandboxed workers
- **Mastra agent system** (phase 2) — real agent/tool/MCP integration, SSE streaming
- **Read replicas + connection pooling** (phase 3) — PgBouncer integration
- **PITR backup** (phase 3B-D) — point-in-time recovery, metrics, log retention
- **OAuth/OIDC** (phase 3E) — OAuth infrastructure via better-auth `genericOAuth` plugin (social providers coming in v0.6)

### Changed
- Phase 0 cleanup: deleted dead code, extracted mock provider, unified token extraction

## v0.2.1 — 2026-07-21

### Added
- Supabase-compatible `/functions/v1/*` path alias (alongside `/api/functions/v1/*`)
- `sinopebase.functions.invoke()` SDK method matching `supabase.functions.invoke()`
- Shared `lookupSessionByToken()` helper — deduplicates 5 session queries
- `FunctionsClient` type exported from SDK

### Changed
- Rate-limit cleanup interval now lazily initialised (not at module import)
- Lint + typecheck: clean

## v0.2.0 — 2026-07-21

### Added
- **better-auth integration** — production auth replacing jose JWT + in-memory store. Email/password auth with PostgreSQL-backed sessions. JWT, API Key, and Bearer plugin architecture. GoTrue-compatible `/auth/v1/*` routes.
- **DropFunctions Edge Functions** — function files (.ts/.js) in configurable directory. Per-function `config` export (auth, timeout, rateLimit). HTTP execution at `/api/functions/v1/:name`. Management CRUD at `/api/functions/v1/:name/source`. Promise.race timeout enforcement.
- **Mastra AI Endpoints** — lightweight AI provider abstraction (OpenAI, extensible). Chat completion + SSE streaming + embeddings at `/api/mastra/*`. Mock provider for development without API keys.
- **Svelte 5 Admin UI** — 7-page SPA (Login, Dashboard, Collections, Edge Functions, AI Playground, Settings, Logs). Dark/light theme via CSS custom properties. Vite build → `ui/dist/` → served at `/_/`. Hash-based SPA router with client-side routing fallback.

### Fixed
- S3 endpoint URL parsing (`localhost:9000` → proper host/port/SSL extraction)
- JWT signature verification in auth middleware (`ParseUnverifiedJWT` → `verifyAccessToken`)
- In-memory logout now invalidates refresh tokens
- PostgREST and Storage routes now require Bearer token authentication
- Path traversal protection on DropFunctions function name parameters
- Auth guard on DropFunctions management routes
- Refresh token rotation on the better-auth path
- Rate-limit cleanup interval lazily initialised

### Changed
- Shared `lookupSessionByToken()` helper replaces 5 duplicated `selectFrom('session')` queries
- Security headers + panic recovery added to `Sinopebase.start()`

## v0.1.0 — 2026-07-21

### Added
- PocketBase v0.25.x 1:1 port to TypeScript/Bun (~250 source files)
- Elysia HTTP framework on Bun runtime
- PostgreSQL 18.4 + RustFS S3 storage (Docker)
- Kysely query builder + pg driver
- supabase-js SDK compatibility layer (28 ATDD tests)
- WebSocket/Phoenix Channels realtime
- 14 PocketBase field types, collections, records, auth, events system
- OAuth2 providers (7 core + 25 stubs)
- Mailer, cron, filesystem abstractions
- 1109 tests, 0 failures
