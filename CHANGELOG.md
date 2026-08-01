# Changelog

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
