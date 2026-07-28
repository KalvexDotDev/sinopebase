# Sinopebase v0.4 — P0 Handoff (Railway)

Written: 2026-07-28
Previous: `HANDOFF.md` (Wave 0), `HANDOFF-ELYSIA-REVIEW.md` (Elysia refactoring)
Status: **Elysia refactoring complete. P0 production blockers remain.**

---

## Platform Change

**Netlify is dropped.** Sinopebase runs on Railway:

- **Topology:** Railway's project canvas visualizes all services and their relationships automatically. No manual diagramming or IaC topology mapping needed — the canvas IS the topology.
- **Observability:** Railway's built-in dashboard provides CPU, memory, disk, network metrics per service. Logs are searchable with filter syntax (`@service:`, `@deployment:`, `@replica:`). Monitors alert on threshold breaches via email + webhooks. Third-party observability (OTel, Datadog, etc.) can be connected via Railway's guide.
- **Monitoring:** Railway monitors + webhooks cover deploy success/failure, crashes, and resource thresholds. For application-level monitoring (auth failures, RLS violations, storage access patterns), Sinopebase emits structured logs that Railway's log filtering surfaces.
- **Deployment:** GitHub → Railway. CI builds the container, Railway deploys it. Immutable, signed images promoted through environments. Staging requires human approval before production.

This eliminates the AWS topology workstream (ECS/Fargate, ALB, WAF, ECR, Secrets Manager, KMS, CloudWatch). Railway provides all of that as a managed platform.

---

## Remaining P0 Blockers (in fix order)

### P0-1: Production Fail-Closed Boot

**Current:** Production mode warns but can silently fall back to in-memory database, local file store, or dev secrets.

**Fix:**
- `src/core/app.ts:initializeServer()` — when `detectMode() === 'production'` and PostgreSQL/S3 config is missing, throw instead of falling back.
- Reject known dev secrets (`sinopebase-dev-*`, `test-*`) at startup in production mode. Already partially done (Wave 0 secure-boot), extend to cover all dev defaults.
- Add `requiredInfrastructure()` preflight check before `listen()`.

**Files:** `src/core/app.ts`, `src/core/config.ts`

### P0-2: Mastra Privileged Tools Gating

**Current:** Mastra MCP tools can query raw database and read raw file store outside request-scoped RLS/storage authorization. Auth is optionally disabled.

**Fix:**
- Gate Mastra tools behind `requireAuth` (already a config option — make it default `true` in production).
- Wrap tool database access in `withRequestContext()` so RLS policies apply.
- Add `@sinopebase/tool` decorator/annotation to mark privileged tools; audit all existing tools.
- Production mode: disable tools that can't be request-scoped.

**Files:** `src/plugins/mastra/plugin.ts`, `src/plugins/mastra/tools/`

### P0-3: Storage Signed URL Cryptographic Contract

**Current:** Signed URLs use HMAC-SHA256 (fixed in Elysia refactoring — HKDF-derived key, dedicated `SIGNED_URL_SECRET`). But the contract needs expansion:
- No per-bucket key scoping
- No key rotation (kid-based)
- No replay detection (single-use tokens)
- No upload signed URLs (only download)

**Fix:**
- Add `kid` (key ID) to token payload for rotation support.
- Add `jti` (JWT ID / nonce) for replay detection — store used nonces with TTL.
- Support `method` claim (`GET` | `PUT`) to scope tokens to operations.
- Per-bucket derived keys via HKDF: `HMAC-SHA256(master, "sinopebase:signed-url:${bucket}:v1")`.
- Add `uploadUrl()` counterpart to existing `signUrl()`.

**Files:** `src/apis/signed-url.ts`, `src/apis/file.ts`

### P0-4: Least-Privilege Database Roles

**Current:** Service database context can execute as the connection/owner role without `SET LOCAL ROLE`. Runtime role bootstrap performs cluster DDL and GRANT statements.

**Fix:**
- Move DDL/GRANT to deployment migrations (`migrations/` directory, run once per environment).
- Application startup validates schema exists, does NOT create/modify it.
- Connection pool uses a low-privilege role by default.
- `service_role` elevation is explicit, scoped to the request, and audit-logged (already done in Elysia refactoring — `logger.info('audit:service_role', ...)`).
- Add `SET LOCAL ROLE` for PostgREST request-scoped database context.

**Files:** `src/core/app.ts`, `src/core/db_connect.ts`, `src/apis/postgrest.ts`, `migrations/`

### P0-5: Realtime Authorization

**Current:** Realtime accepts client broadcasts, has unbounded subscription/message paths, does not enforce column projection after row visibility.

**Fix (minimum viable for single-replica):**
- Gate subscriptions behind auth (already wired via WebSocket upgrade handler).
- Validate subscription topics against a whitelist of authorized channels.
- Apply column-level projection from the table schema.
- Disable client broadcasts in production (broadcast is server-only).
- Add per-connection message rate limiting.

**Files:** `src/apis/realtime.ts`, `src/core/realtime/`

### P0-6: Upload Buffering + Body Limits

**Current:** Uploads are buffered entirely before a body limit is enforced.

**Fix:**
- Apply Elysia body limit middleware BEFORE the storage upload handler.
- Stream large uploads through a temporary file (not memory) using Bun's `Bun.file()` + `.stream()`.
- Enforce `Content-Length` check before reading body.
- Add `maxUploadSize` config option (default 100 MB).

**Files:** `src/apis/file.ts`, `src/apis/middlewares_body_limit.ts`

### P0-7: Auth Token Lifecycle (Canonical)

**Current:** Token rotation restored (Elysia refactoring). Still needed:
- Key ID (`kid`) in JWT header for rotation.
- Issuer (`iss`) and audience (`aud`) enforcement.
- Atomic refresh rotation with replay-family revocation (partially done in `auth-store.ts`).
- Access/refresh token semantic separation (currently conflated in better-auth bridge).

**Fix:**
- Add `kid` to JWT generation, validate on parse.
- Enforce `iss` and `aud` claims in `ParseJWT()`.
- Complete the replay-family revocation in `createAuthPlugin()` refresh handler.
- Move refresh token storage out of `session.token` column into a dedicated `refresh_tokens` table.

**Files:** `src/apis/auth.ts`, `src/apis/auth-jwt.ts`, `src/apis/auth-store.ts`, `src/tools/auth-better/`

---

## Not P0 — Deferred to Wave 1

- **TLS:** Railway terminates TLS at the edge. Internal service-to-service is within Railway's private network. No Sinopebase-level TLS config needed unless doing custom certs.
- **Realtime fan-out (cross-process):** Requires Redis/NATS pub-sub. Deferred until multi-replica scaling.
- **Horizontal scaling:** Railway can scale replicas, but Realtime is process-local. Multi-replica requires P0-5 + fan-out.

---

## How Railway Changes Things

| Concern | Before (Netlify/AWS) | Now (Railway) |
|---|---|---|
| Topology | Manual AWS diagram | Project canvas (live) |
| Metrics | CloudWatch | Railway dashboard (CPU, mem, disk, net) |
| Logs | CloudWatch | Railway logs (filterable, searchable) |
| Alerts | CloudWatch Alarms | Railway monitors + webhooks |
| Secrets | AWS Secrets Manager | Railway shared variables |
| TLS | Manual cert management | Railway edge termination |
| Deploy | ECR + ECS/Fargate | Railway GitHub integration |
| DB | Netlify Database | Railway PostgreSQL plugin |
| Storage | Netlify Blobs | Railway volumes or S3 plugin |
| CI/CD | Manual pipeline | GitHub Actions → Railway |

**New unstarted tasks (Railway-specific):**
- Railway PostgreSQL plugin configuration (replaces Netlify Database)
- Railway volume or S3 plugin for file storage (replaces Netlify Blobs)
- Railway webhook receiver for deploy events in Sinopebase health endpoint
- Structured log format for Railway's `@attribute:value` filter syntax

---

## Current Metrics

```
Tests:   1,384 pass / 0 fail (122 files)
Build:   1,144 modules / 4.16 MB
Type errors in owned files: ~5 (from Elysia chain types; 282 in legacy port code)
Trivy:   0 CRITICAL
```

## Verification

```powershell
bun run build              # Must pass
bun test                    # 1,384 tests must pass
bun run typecheck           # 0 new errors in owned files
```
