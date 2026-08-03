# v0.8 Handoff — SDK Sinope Port + Practical Gaps

**Date:** 2026-08-02
**Status:** Planned
**Depends on:** v0.7
**Estimated:** ~6 days

## Context

Full supabase-js v2 API gap analysis completed (2026-08-02). Sinopebase SDK covers 35% of the supabase-js surface (46/133 methods). v0.8 targets all P0 (sinope port blockers) and P1 (practical gaps), raising coverage to ~67%.

The SDK ships as a monorepo: `import { createClient } from 'sinopebase-js'` with sub-packages re-exported (`sinopebase-js/auth`, `sinopebase-js/storage`, etc.).

## Tracks

### Track A: Sinope Port Blockers (P0 — 2 days)

These are the hard dependencies for porting sinope from Supabase to Sinopebase. Every item was traced from actual sinope source code.

- [ ] **A1. `sinopebase-ssr` package** — `createServerClient(url, key, { cookies: { getAll, setAll } })` and `createBrowserClient(url, key)`. Cookie-based session management for SvelteKit. Must expose `.auth.getSession()`, `.auth.getUser()`, `.auth.exchangeCodeForSession()`, `.auth.onAuthStateChange()`.
- [ ] **A2. `getSession()` on AuthClient** — currently missing. Sinope's `hooks.server.ts` calls `locals.supabase.auth.getSession()` on every request.
- [ ] **A3. `exchangeCodeForSession(code)` on AuthClient** — OAuth callback handler. Sinope's `/auth/callback/+server.ts` depends on this.
- [ ] **A4. `onAuthStateChange()` — real implementation** — currently a no-op stub. Sinope's `+layout.svelte` uses this to detect sign-in/out/token-refresh. Must fire on `SIGNED_IN`, `SIGNED_OUT`, `TOKEN_REFRESHED`.
- [ ] **A5. `signInWithOAuth()` on AuthClient** — OAuth login initiation. Maps to better-auth's `signIn.social()`.
- [ ] **A6. `.maybeSingle()` — verify correct behavior** — returns `null` when no row matches (not an error). Already implemented in SDK, needs verification against supabase-js contract.
- [ ] **A7. Realtime `postgres_changes` contract tests** — sinope uses 3 channels per page. Verify payload shape (`{ new, old, event_type, schema, table }`), filter support (`id=eq.X`), and per-subscriber RLS filtering. Write against sinope's actual table schema.
- [ ] **A8. `removeChannel()` on RealtimeClient** — sinope calls `client.removeChannel(channel)` for cleanup on `$effect` teardown.

### Track B: Practical SDK Gaps (P1 — 2 days)

Methods that aren't blocking sinope but are commonly used and expected by supabase-js users.

#### PostgREST
- [ ] **B1. `upsert()`** — `insert()` with `{ upsert: true }` option. Server-side already supports `ON CONFLICT`.
- [ ] **B2. `not(column, operator, value)` filter** — negate any filter. Syntactic sugar for `or()` wrapping.
- [ ] **B3. `textSearch(column, query, options)`** — maps to `fts`/`plfts`/`phfts`/`wfts` server operators. Implement or permanently stub with clear error.
- [ ] **B4. `contains(column, value)` / `containedBy(column, value)`** — JSONB/array containment. Already in SDK type definitions, needs server-side wiring.

#### Auth
- [ ] **B5. `updateUser(attributes)`** — email, password, metadata updates. better-auth supports this via `auth.api.updateUser()`.
- [ ] **B6. `resetPasswordForEmail(email)`** — password reset flow. better-auth has `auth.api.forgetPassword()`.
- [ ] **B7. `setSession(session)`** — restore session from stored tokens. Needed for programmatic session restoration.

#### Realtime
- [ ] **B8. `setAuth(token)` on RealtimeClient** — refresh the WebSocket auth token without reconnecting.
- [ ] **B9. `sendHeartbeat()` / `onHeartbeat()`** — manual heartbeat control. Already wired server-side, needs SDK methods.
- [ ] **B10. Connection state methods** — `isConnected()`, `isConnecting()`, `isDisconnecting()`, `connectionState()`. Wrap WebSocket readyState.

#### Storage
- [ ] **B11. `copy(fromPath, toPath)` / `move(fromPath, toPath)`** — server-side file operations. Needs backend endpoint.
- [ ] **B12. `exists(path)`** — HEAD request to check file existence.
- [ ] **B13. `getBucket(name)` / `updateBucket(name, options)` / `deleteBucket(name)`** — full bucket CRUD. Backend endpoints exist, SDK methods missing.
- [ ] **B14. `createSignedUrls(paths, expiresIn)` (plural)** — batch signed URL generation.

#### Functions
- [ ] **B15. `setAuth(token)` on FunctionsClient** — per-request token override.

### Track C: S3 Migration Bucket (P1 — 1 day)

**Problem:** Railway template users deploy a prebuilt image — they can't add local SQL files to `supabase/migrations/`. They need a way to ship schema changes without forking the repo.

- [ ] **C1. `MIGRATIONS_BUCKET` env var** — S3 bucket name containing `.sql` migration files. At startup, list objects, download in timestamp order, apply any not yet tracked in `_migrations`.
- [ ] **C2. `MIGRATIONS_REGION` / `MIGRATIONS_ENDPOINT` / `MIGRATIONS_ACCESS_KEY` / `MIGRATIONS_SECRET_KEY` env vars** — optional overrides for the migrations bucket. Default to the same S3 config as file storage (`RUSTFS_*`).
- [ ] **C3. Reuse `loadSqlMigrationsFromDirectory` pattern** — already built for local `supabase/migrations/*.sql`. The S3 variant streams files from the bucket instead of reading from disk. Same validation, same tracking table.
- [ ] **C4. Railway template docs** — document the migration flow: create a `migrations/` folder in your bucket, upload timestamped `.sql` files, redeploy.

## Success Criteria

- [ ] Sinope `hooks.server.ts` runs against sinopebase without modification
- [ ] Sinope `auth/callback/+server.ts` handles OAuth through sinopebase
- [ ] Sinope realtime channels (`postgres_changes`) receive correct payloads
- [ ] `signInWithOAuth`, `updateUser`, `resetPasswordForEmail` work end-to-end
- [ ] All P0+P1 methods implemented and tested — the SDK covers everything a typical app calls
- [ ] `sinopebase-js` npm package published

## See Also

- [v0.7 Handoff](handoff-v0.7.md) — prerequisite
- [v0.9 Handoff](handoff-v0.9.md) — P2 completeness follow-up
- [SDK Gap Analysis](handoff-v0.7.md#sdk-gap) — moved to handoff-v0.8 per 2026-08-02 triage
