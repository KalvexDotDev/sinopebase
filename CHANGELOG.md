# Changelog

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
