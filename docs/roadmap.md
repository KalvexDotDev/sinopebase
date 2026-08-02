# Roadmap

Sinopebase is a solo-founder project. Priorities are driven by what sinope needs for ISO27001 compliance, plus what makes sinopebase useful to others who want a Supabase-compatible backend they own.

## Current — v0.6.2 (shipped 2026-08-01)

- PostgreSQL + S3 storage
- better-auth: email/password, OAuth (social + enterprise OIDC)
- Realtime: Phoenix Channels + PG LISTEN/NOTIFY + full Presence
- PostgREST: 10 filter operators, `or`/`and`, comma-quoting, count headers
- Edge functions: Bun Worker sandbox
- AI: Mastra agents, RAG, MCP tools, SSE streaming
- Admin UI: Svelte 5 dashboard at `/_/`
- Docker image on GHCR, Railway deploy button
- 1,473 tests, CI gates (format, lint, typecheck, SAST, container scan)

## v0.7 — Hardening (next)

**Goal:** CI green, core hardening, pre-audit SDK items.

- 19 CI failures → zero
- OAuth secret encryption at rest (AES-256-GCM)
- Issuer URL validation (https-only, no loopback)
- `signInWithOAuth()` on the SDK
- SDK heartbeat timer for Presence
- SDK `in()` comma-quoting fix
- Stateless JWT signed URLs
- RPC endpoint (`/rest/v1/rpc/:fn`)
- Dead PocketBase OAuth code removed (~3,000 lines)
- `docs/realtime.md` with Presence code examples

## v0.8 — SDK: Sinope Port + Practical Gaps

**Goal:** Sinope port unblocked. Prioritized SDK interfaces covered.

**Sinope blockers:**
- `sinopebase-ssr` package (SvelteKit cookie-based auth)
- `getSession()`, `exchangeCodeForSession()`, real `onAuthStateChange()`
- `signInWithOAuth()` end-to-end
- Realtime `postgres_changes` validated against sinope's usage
- `removeChannel()` for cleanup

**Practical gaps:**
- PostgREST: `upsert`, `not`, `textSearch`, `contains`
- Auth: `updateUser`, `resetPasswordForEmail`, `setSession`
- Realtime: `setAuth`, `sendHeartbeat`, connection state
- Storage: `copy`/`move`/`exists`, `getBucket`/`updateBucket`/`deleteBucket`, `createSignedUrls`
- Functions: `setAuth`

## v0.9 — SDK: Completeness

**Goal:** 80%+ coverage of prioritized SDK interfaces. A supabase-js user hits no missing methods in normal use. MFA, Passkey, Web3, and Admin APIs explicitly out of scope — they're Supabase Cloud features that don't map to better-auth.

- Postgres range operators, multi-pattern LIKE, response format modifiers
- Auth: `getClaims`, `getUserIdentities`, session lifecycle
- Realtime: `removeAllChannels`, `presenceState`, utilities
- Storage: `info`, `emptyBucket`, presigned upload URLs
- Explicit "not yet implemented" stubs for deferred methods

## 1.0 — Production-Ready

**Goal:** All tests pass, all critical/high risks mitigated. ISO27001-ready.

- Supply chain attestation (SBOM, SLSA provenance, signed containers)
- Production-mode secret enforcement (fail-closed on weak secrets)
- Cryptographically-signed reusable URLs
- Dependency-aware health checks + graceful shutdown
- Structured logging + OpenTelemetry
- Backup/restore proven with defined RPO/RTO
- Published benchmarks
- `sinopebase-js` npm package

## 2.0+ — New Features

Compatibility and hardening got us to 1.0. Now we build things Supabase doesn't have.

- **AI-generated backends** — natural language → collections, RLS, migrations, SDK types. "I need a store with Stripe checkout" → working backend in 60 seconds. Powered by Mastra.
- **Payments via better-auth** — Stripe checkout, subscription management, usage-based billing. Your BaaS handles your billing too.
- **One-click deploy** — `sinopebase deploy` to Hetzner/VPS. Provision, configure, SSL, hand you a URL and API key.
- **SQLite dev mode** — zero-dependency development, PostgreSQL for production. One env var swap.
- **Local-first sync** — CRDT-based offline-first with automatic conflict resolution. Nobody in the BaaS space does this well.

## Explicitly Not On the Roadmap

- Managed cloud hosting — not the business model
- Supabase Studio parity — sinopebase has its own admin UI
- Multi-tenant SaaS — sinopebase is single-tenant by design
- Vectors/pgvector, Branching, Logflare — these are Supabase Cloud features

## Philosophy

- **Sinope's needs come first.** Features sinope doesn't use may wait.
- **If nobody uses it, we delete it.** Dead code is a liability.
- **The SDK is a contract.** supabase-js users should need zero code changes to switch.
- **1.0 is a security bar, not a feature count.** Production-readiness means proven recovery, signed artifacts, and hard fail-closed boundaries.
