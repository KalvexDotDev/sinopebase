# Wave 1 Scope Creep — Features Delivered in Wave 0

Written: 2026-07-24 UTC
Reason: audit trail for features that landed ahead of schedule
Source: code-review finding during Wave 0 integration; confirmed against HANDOFF.md Wave 1 security/production blocker list

## Overview

The Wave 0 code-review identified three features in the baseline that belong to the Wave 1 (provider/security) release track but were already implemented in the codebase at engagement. This document records what was found, why it landed early, and what remains deferred.

---

## 1. PostgREST Embedded-Resource Selection Engine

### What it does

Implements PostgREST's `select=column,related(*)` syntax at `/rest/v1/:table`. Clients can embed related rows via foreign-key relationships in a single query, avoiding N+1 round trips. Supports column projection, alias (`column:alias`), embedded relationship nesting, and the `!inner` modifier.

### Where it lives

**File:** `src/apis/postgrest.ts` (~190 lines of the selection engine)

**Key functions:**
- `applySelection` (line 473) — entry point; applies parsed select to query results
- `materializeSelection` (line 484) — recursive FK resolution, row fetching, embedding
- `resolveRelationship` (line 565) — FK relationship disambiguation via scoring
- `parseSelect` (line 617) — parses `select=col1,related(col2)` into a `Selection[]` AST
- `relationshipScore` (line 604) — scoring heuristic for FK candidate disambiguation
- `buildSingularResponse` (line 676) — handles `application/vnd.pgrst.object+json` singular coercion
- `projectColumns` (line 547) — column projection from source row
- `splitTopLevel` (line 649) — comma splitting respecting parenthesized groups

**Key types:**
- `Selection = ColumnSelection | RelationshipSelection` (lines 51-66)
- `SelectedRow`, `SelectResult`, `SingularResponse` (lines 68-82)
- `PostgrestSelectOptions` (line 43)

### Why it landed early

The baseline compatibility contract (Wave 0-C) revealed that Supabase client SDKs use embedded `select=*` in nearly every query. The existing PostgREST handler was silently ignoring the `select` parameter — clients received flattened rows without embedded relations, which is silent data loss rather than a hard error. Making the handler truthfully handle embedded selects was a prerequisite for the compatibility matrix and for any client SDK integration. The cost of deferring would have been cascading bugs when Wave 1 integrated client SDKs.

### What's deferred

- Cross-process fan-out (this is in-process resolution only, not a PostgREST middleware proxy)
- Multi-level deep nesting beyond the recursive `materializeSelection` path
- Separate dedicated test coverage for the `!inner` filtering path (works inline but not independently validated)

---

## 2. RealtimeHub with Broadcast Auth + Postgres Changes Pipeline

### What it does

Implements a Supabase Realtime-compatible Phoenix Channels WebSocket server. Handles `phx_join`/`phx_leave`/`phx_heartbeat` lifecycle, broadcast messaging with authorization, and PostgreSQL change delivery for local PostgREST mutations. The HANDOFF.md baseline confirmed this was a pre-existing P0 security blocker that received partial remediation.

### Where it lives

**File:** `src/apis/realtime.ts` (~330 lines)

**Key classes / structures:**
- `RealtimeHub<TContext>` (line 103) — central class managing client state, topic bindings, message routing
- `RealtimeHubOptions<TContext>` (line 64) — configuration hooks: `authorize`, `canRead`, `maxDeliveryQueue`, `maxBroadcastPayloadSize`
- `ClientState<TContext>` (line 88) — per-connection protocol, auth context, topic-to-binding map
- `PostgresChange`, `PostgresChangesFilter`, `PostgresChangesBinding`, `PreparedRealtimeChange`, `PostgrestChangePublisher` — event/contract types
- `PendingDelivery` (line 94) — queued delivery with column projection
- `WSClient` (line 76) — minimal WebSocket interface shared by Elysia and test doubles
- `createRealtimeHub`, `createRealtimeWebSocketHandler` (lines 381, 387) — factory functions

**Key methods:**
- `handleMessage` -> `processMessage` (lines 137, 149) — serialized message dispatch; ensures `phx_join` completes before broadcasts evaluate
- `preparePostgresChange` (line 299) — evaluates all client bindings, applies `canRead`, column-projects, bounds delivery queue per client, returns deferred `deliver()` callback
- `publishPostgresChange` (line 375) — convenience wrapper for immediate delivery
- `removeClient` (line 293) — cleanup on disconnect

**Security properties implemented (per file header, lines 10-16):**
- Joined-state enforcement: broadcast rejected unless topic has been joined (line 243-248)
- Broadcast auth: unauthenticated broadcasts rejected when `authorize` is configured (line 253-258)
- Payload size limit: default 100 KB, prevents DoS (line 264-271)
- Column projection: per-binding `columns` filter limits which columns appear in `record`/`old_record` (lines 555-587)
- Bounded delivery queue: max 256 pending deliveries per client, drops oldest (lines 340-356)
- Serialised messages: per-client promise chain ensures no race between `phx_join` and broadcast (line 139-145)
- Heartbeat token re-validation: expired token triggers eviction + WebSocket close (lines 209-237)

### Why it landed early

The HANDOFF.md baseline review (line 90) identified Realtime as a pre-existing P0 security blocker: "Realtime broadcast can publish without authenticated joined state; token refresh/revocation is not enforced; full old/new rows lack column projection and tenant-transfer authorization." The scope-creep implementation addresses the first three of these — joined-state enforcement, broadcast auth, token refresh on heartbeat, and column projection — all of which are prerequisites for Wave 1 security hardening. The HANDOFF subagent queue (item 6) lists Realtime as requiring three independent security reviews.

### What's deferred

- Native WAL/logical-replication capture for writes made by other processes (documented in file header line 7: "intentionally same-process")
- Multi-replica / cross-process fan-out for the delivery queue
- Tenant-transfer authorization on old/new row images (confirmed as pre-existing blocker in HANDOFF.md)
- The `canRead` hook is wired (line 323) but its test coverage is identified as pending in the engage baseline
- `filter` clause execution in binding matching (line 512) — only `=` equality filters and basic comparison operators are implemented; the full Supabase Realtime `filter` expression language is not replicated

---

## 3. Storage RLS Policy Layer

### What it does

Implements `PostgresStorageAccessPolicy`, a PostgreSQL-backed `StorageAccessPolicy` that replaces in-process/local-file storage authorization with database-level RLS. All storage authorization decisions are delegated to PostgreSQL via `SET LOCAL ROLE` and per-operation RLS policies.

### Where it lives

**File:** `src/apis/storage-postgres.ts` (~360 lines)

**Interface:** `StorageAccessPolicy` in `src/apis/storage-access.ts`

**Key class:**
- `PostgresStorageAccessPolicy` (line 36) — implements `StorageAccessPolicy` with PostgreSQL RLS-backed authorization

**Key methods:**
- `ensureMetadata` (static, line 43) — idempotent schema provisioning on startup:
  - Creates `storage` schema, `storage.buckets` and `storage.objects` tables
  - Grants schema usage and table permissions to `anon`, `authenticated`
  - Enables RLS on both tables
  - Creates per-operation RLS policies (SELECT/INSERT/UPDATE/DELETE)
  - Drops the legacy permissive `storage_anon_all_objects` policy
  - Seeds a default public `test-bucket`
- `scoped` (line 313) — wraps all storage operations in `db.withRequestContext` so PostgreSQL enforces `SET LOCAL ROLE` + `auth.uid()`
- `mapDatabaseError` (line 325) — translates PostgreSQL error codes to `StorageAccessError` (403, 404, 409, 503, 500)
- Standard storage operations: `listBuckets`, `createBucket`, `listObjects`, `upload`, `download`, `remove`, `authorizeSignedUrl`, `downloadPublic`

**RLS policy structure (in `ensureMetadata`, lines 89-122):**
- `anon` role: CRUD on public buckets only (`bucket_id IN (SELECT id FROM storage.buckets WHERE public = true)`), with separate policies per operation (SELECT/INSERT/UPDATE/DELETE)
- `authenticated` role: full access to all buckets and objects
- `service_role`: bypasses RLS entirely (connection-level identity, not via `SET LOCAL ROLE`)
- `file_size_limit` and `allowed_mime_types` constraints checked via `validateBucketConstraints` on upload (line 198-201)

### Why it landed early

The storage metadata schema is a prerequisite for the compatibility contract (Wave 0-C) and for fail-closed production boot in the container. The engage baseline (line 53) lists "Storage: 2 missing metadata-schema failures" — tests that fail because the metadata schema is not provisioned when storage tests run in isolation. Without this layer, storage operations fall back to local-filesystem or in-memory storage (the container healthcheck reports "memory/local fallbacks" as an open production blocker). The RLS policies also address the HANDOFF's requirement that "No security shortcut for compatibility" is accepted — the policies provide tenant-aware authorization rather than permissive global access.

### What's deferred

- Per-object ownership RLS (current policies allow any authenticated user to access any object in any bucket; true tenant isolation requires owner-ID checks)
- Signed URL authorization beyond existence checks (`authorizeSignedUrl` at line 267 checks object existence but does not verify URL expiry or cryptographic signatures)
- `file_size_limit` and `allowed_mime_types` are stored and validated on upload but there is no migration path for existing buckets
- The HANDOFF compatibility matrix explicitly lists "expiry-only storage URLs, buffered uploads" as unproven boundaries
- `downloadPublic` bypasses the `scoped` context and uses the writer directly (line 283-298) — this works for public bucket reads but means the operation is running as the connection/owner identity rather than a scoped role

---

## Reference

- HANDOFF.md `docs/releases/v0.4/HANDOFF.md` — baseline blocker list and subagent queue
- Engage baseline `docs/releases/v0.4/evidence/2026-07-22-engage-baseline.md` — failure taxonomy and test counts
- Wave 0 coordination `docs/releases/v0.4/wave-0-coordination.md` — work item ownership and integration order
- Compatibility matrix `docs/compatibility/sinope-supabase-matrix.md` — provider capability bounds
