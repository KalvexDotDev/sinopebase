# Changelog

## Unreleased

### Security
- Upgraded better-auth from 1.6.26 to 1.7.14. This fixes OAuth state accepted as a Magic Link (GHSA-965c-763c-88jm, critical), sign-in as another user through the OAuth Proxy (GHSA-r4xp-prcw-77qf, high), device login approval that hides the requesting client (GHSA-q84f-53jg-9ppm, high), and concurrent requests exceeding database-backed rate limits (GHSA-44jh-23m7-hpcf, low). 1.7 already contains our ID-token signup patch, so `patches/better-auth@1.6.26.patch` is removed.
- Upgraded decode-uri-component to 0.5.1 (GHSA-qr28-fpjm-wq7f) and qs to 6.17.1 (GHSA-6pq8-jhm2-2vcw), and the admin UI's vite to 6.4.5 (GHSA-8g5g-mxqh-grgj). The admin UI audit ignores GHSA-gcqx-w48m-w2h4 (low). It affects deepmerge, which has no patched release and only merges the UI's build-time Vite configuration.
- The Better Auth tables (`user`, `session`, `account`, `verification`, `refresh_tokens`) are internal. Every startup revokes table and column privileges on them from `PUBLIC`, `anon` and `authenticated`, and startup fails before listening if any browser privilege remains. A failed PostgreSQL auth setup now refuses startup instead of falling back to in-memory auth (KalvexDotDev/sinope#861).

### Fixed
- On PostgreSQL 16 and later, the connection role is granted the request roles `WITH SET TRUE`. A role's creator receives ADMIN membership without SET permission there, so switching to `anon`, `authenticated` or `service_role` failed (KalvexDotDev/sinope#861).
- Replicas starting together on a new database take turns creating and hardening the Better Auth tables. Previously they could deadlock and refuse startup.

### Added
- GoTrue password recovery for the official SDKs (#67). `resetPasswordForEmail` posts to `POST /auth/v1/recover`, which answers `{}` whether or not the account exists and sends at most one recovery email per user per 60 seconds. The email links to `redirect_to` with `token_hash` and `type=recovery` appended; `redirect_to` is used only when its origin is trusted (`SINOPEBASE_EXTRA_ORIGINS`), and otherwise the link goes to the new `SINOPEBASE_SITE_URL` (default `BETTER_AUTH_URL`). `verifyOtp({ type: 'recovery', token_hash })` posts to `POST /auth/v1/verify`, which uses up the single-use, one-hour token, confirms the email address, and returns a recovery session. A new recovery link replaces any older one.
- A recovery session can set a new password with `updateUser({ password })` and no `current_password`, as in GoTrue. It can do this once; after that the session behaves like an ordinary one.
- `SMTP_ADMIN_EMAIL` and `SMTP_SENDER_NAME` (GoTrue's names) set the From address and display name of every transactional email. Before this change, no From address was set at all. Startup now fails when `SMTP_HOST` is set without `SMTP_ADMIN_EMAIL`. Port 465 uses implicit TLS; port 587, the default, now requires STARTTLS instead of attempting it only when offered.

### Changed
- Startup adds the nullable `account` columns `idToken`, `accessTokenExpiresAt`, `refreshTokenExpiresAt` and `scope`. Better Auth 1.7 fails auth requests while they are missing.
- A generic OIDC provider whose discovery document cannot be fetched now answers sign-in with 404 `PROVIDER_NOT_FOUND` instead of 400 `INVALID_OAUTH_CONFIGURATION`. Better Auth 1.7 skips such a provider.
- `PUT`/`PATCH /auth/v1/user` return GoTrue error codes for password updates (#57): `current_password_required` and `current_password_mismatch` (400), `weak_password` with reasons (422, for passwords outside 8–128 characters) and `same_password` (422). A successful password change ends every other session of the user, deletes their refresh tokens and cancels pending recovery links. The calling session stays signed in. Changing the email address also cancels pending recovery links.
- A recovery link is bound to the address it was mailed to: verifying it fails with `otp_expired` once the account has a different address. If delivery fails, the new link is dropped, any earlier link stays valid, and the 60-second window reopens so the request can be retried.
- The recovery email subject is now "Reset your password" instead of "Sinopebase password reset".

### Removed
- The non-standard `POST /auth/v1/reset-password`, and Better Auth's `/api/auth/request-password-reset` and `/api/auth/reset-password` routes. Recovery now goes only through `/auth/v1/recover` and `/auth/v1/verify`. The Sinopebase SDK's `resetPasswordForEmail(email, { redirectTo })` calls `/auth/v1/recover`.

## v0.10.1 — 2026-10-25

### Security
- Rebuilt on Bun 1.4.4. The compiled server, the staging bootstrap job and the release binaries embed the Bun runtime, so anything built with Bun 1.3.14 or earlier carries the brotli decoder out-of-bounds write (GHSA-663w-cv8g-jj2p, CVE-2026-111497), a root store that still trusts the compromised eMudhra (emSign) intermediate CAs (GHSA-26q8-h657-pf84) and the HTTP/3 QPACK flaw (GHSA-cf8x-9m69-3gg3). Rebuild and redeploy images and binaries from this release.
- Pinned the Dockerfile builder and runtime-library stages, the staging bootstrap image and every CI and release workflow to Bun 1.4.4. The copied `libstdc++` follows the new Alpine base (6.0.34).
- Cleared the server dependency advisories: zod 4.6.6 (GHSA-mrhx-c7xc-m3w5), nodemailer 10.1.4 (GHSA-m943-m63m-w62w, GHSA-85x2-q946-cp5h, GHSA-8c8m-p3m8-cjg8), fast-uri 3.1.9 and stream-json 3.7.0 (#63), after the earlier dependency and runtime image findings (#49).
- Cleared the admin UI toolchain advisories: vite 6.4.4, devalue 5.9.3, nanoid 3.3.18, postcss 8.5.23 and source-map-js 1.2.2. CI now audits `ui/` as well (#64).

### Fixed
- PostgreSQL RPC calls keep their declared return shapes (#55).
- PostgreSQL storage lists return names relative to the requested folder (#53).

## v0.10.0 — 2026-10-05

### Added
- PostgREST `match` and `imatch` filters for case-sensitive and case-insensitive PostgreSQL regular expressions (#41).
- CLI support for SMTP settings supplied through environment variables in server deployments (#12).
- Opt-in multi-replica configuration using the existing server image and CLI. Railway remains a single-instance deployment with its existing defaults (#44).
- PostgreSQL advisory locking around startup migrations and CLI wiring for `LISTEN/NOTIFY` delivery of committed row changes to clients on other replicas.
- Migration SQL and ledger writes now run in one transaction on the advisory-lock connection, so losing that connection rolls back the migration; the Kubernetes example makes its scratch volume writable to the non-root process.
- Listener connectivity as a condition of `/api/ready` in multi-replica mode; `/api/health` remains the liveness endpoint.
- A generic, credential-free Kubernetes manifest and deployment guide, with Kubeconform validation in CI.

### Changed
- S3 endpoint URLs now use port 443 for HTTPS and 80 for HTTP when no port is specified; bare hosts retain the RustFS default port.
- Multi-replica mode requires shared PostgreSQL and S3, a shared ingress rate-limit assertion, and common OAuth configuration when OAuth is used. Local OAuth and function management, backups, and restores are unavailable in this mode.

### Fixed
- Admin UI collection, storage, log, and authentication journeys, with direct API and browser regression coverage (#43).
- Signed storage downloads and service authorization, while preserving the hardened non-root, read-only production container (#19).
- Atlas HTTPS S3 endpoint parsing and trusted-proxy client IP handling (#42).

### Tests
- Added enabled/disabled deployment configuration tests, in-memory migration and listener failure tests, and PostgreSQL integration tests for advisory locking and row-change notifications.
- The new-code gate now applies its absolute CRAP limit to new functions while continuing to require 95% changed-line coverage and positive/negative test claims for edits to existing functions.
- The changed-line mutation gate now blocks below 70% and publishes all survivors for review; the previous 100% requirement included diagnostic text and defensive branches that could not be killed through observable behavior.

## v0.9.0 — 2026-08-28

### Added
- **Changed-line mutation testing** — CI mutates production code changed from the merge base and requires every generated mutant to be killed.
- **New-code quality gates** — changed executable lines require at least 95% coverage, changed functions require a maximum CRAP score of 6, and every changed production behavior must declare both positive and negative tests.

### Security
- **Fail-closed production signup** — public email/password signup is disabled in production unless `ALLOW_SIGNUPS=true` is set explicitly. Development remains open by default and can be closed with `ALLOW_SIGNUPS=false`.

### Fixed
- **CI test isolation** — CI ignores the opt-in destructive drop-functions suite correctly, recognizes equivalent TypeScript baseline diagnostics, uses signed SSR session-cookie fixtures for protected auth flows, and reserves OS-assigned ports for health tests.
- **Patched container TLS libraries** — the runtime image upgrades Alpine's OpenSSL libraries from the digest-pinned rootfs to the latest security-fixed repository versions before vulnerability scanning and release.

## v0.8.5 — 2026-08-18

### Fixed
- **S3-backed production migrations** — the production entry point now runs the complete system and application migration lifecycle exactly once after PostgreSQL connects and before listening. `MIGRATIONS_BUCKET` SQL files are discovered through the configured S3-compatible store, ordered, applied through the existing `_migrations` ledger, and skipped on subsequent boots.
- **Fail-closed migration discovery** — an unreachable or missing configured migration bucket is logged as a startup error and aborts production startup instead of allowing a healthy server to run against an un-migrated application schema.

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
