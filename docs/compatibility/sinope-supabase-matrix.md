# Sinope compatibility matrix

**Scope.** This is the bounded compatibility contract exercised between Sinopebase and the paired Sinope experiment at `D:\Projects\sinope-sinopebase`. It is not a claim of Supabase feature parity or production readiness. The implementation is currently experimental and uncommitted.

**Evidence captured 2026-07-22.** The focused Sinopebase command below passed **49 tests, 121 assertions, 0 failures** on Bun 1.3.14 against the local test PostgreSQL instance. The paired Sinope integration test is conditional on `SINOPEBASE_TEST_URL`, `SINOPEBASE_TEST_ANON_KEY`, and `SINOPEBASE_TEST_SERVICE_ROLE_KEY`; it is retained as an external application contract but was not rerun by this matrix capture.

```powershell
bun test src/apis/postgrest.test.ts src/apis/postgrest-head-count.test.ts src/apis/postgrest-in-filter.test.ts src/apis/realtime-postgres-changes.test.ts src/apis/file.test.ts src/core/postgres-role-bootstrap.test.ts src/core/db-postgres-rls.test.ts tests/tools/auth-better/supabase-bridge.test.ts tests/integration/auth-better.test.ts
```

The machine-readable inventory is [sinope-supabase.contract.json](../../tests/contract/sinope-supabase.contract.json). It is the release-review index for these tests; it does not replace the tests.

## Tested compatibility surface

| Area | Exact exercised behavior | Evidence | Required dependency / security condition |
| --- | --- | --- | --- |
| GoTrue auth | `signup`, password grant, refresh grant, `/user`, and logout return raw GoTrue-style success/error bodies, not Sinopebase `{ data, error }` wrappers. The bridge returns root-level sessions/users and root-level auth errors. | `tests/tools/auth-better/supabase-bridge.test.ts`; `tests/integration/auth-better.test.ts` | better-auth backed by PostgreSQL; bearer session lookup must remain available. |
| Auth identity shape | Newly-created better-auth IDs are UUIDs; Sinope's paired shim also normalizes `public."user".id` and mirrors new users into `auth.users` so Sinope's existing trigger creates `public.users`. | `src/tools/auth-better/index.ts`; paired `supabase/sinopebase_compat.sql`; paired `tests/integration/sinopebase-compat.test.ts` | Isolated Sinope schema with `auth.users`, `gen_random_uuid()`, and trigger-creation privilege. The shim is experiment-only, not a production migration. |
| Sinope application flow | A configured `@supabase/supabase-js` client can sign up, authenticate, service-onboard a tenant, read tenant-scoped frameworks, create a certification, and load its packet. | paired `tests/integration/sinopebase-compat.test.ts` | All three `SINOPEBASE_TEST_*` variables; seed data containing ISO 27001 and SOC 2; isolated experiment database. |
| PostgREST reads | `eq` filters; `order`; singular media type returns one object; zero/many singular results return HTTP 406 with `PGRST116`; `HEAD` returns empty body and `content-range: */N`; UUID `in.(...)` becomes separate PostgreSQL operands. | `src/apis/postgrest.test.ts`; `src/apis/postgrest-head-count.test.ts`; `src/apis/postgrest-in-filter.test.ts` | PostgreSQL for the UUID `IN` regression; memory database covers selected HTTP shape cases. |
| Embedded selects | Single-column foreign-key outbound object embeds, inbound array embeds, aliases using the FK column, and `!inner` parent filtering. | `src/apis/postgrest.test.ts` | PostgreSQL production paths require public-schema FK metadata; composite FKs are excluded by implementation. |
| Request-scoped RLS | `anon`, `authenticated`, and `service_role` are applied transaction-locally; JWT `sub` reaches `auth.uid()`; cross-member update is denied; concurrent pooled requests do not leak identity; HTTP REST and HEAD counts see the same policy context. | `src/core/db-postgres-rls.test.ts` | PostgreSQL roles, role membership for the connection role, `auth.uid()`, enabled RLS policies, and a DB account able to establish roles. Service role intentionally bypasses RLS. |
| Request-role bootstrap | `anon`, `authenticated`, and `service_role` are created as no-login/non-superuser roles, membership is granted, `SET LOCAL ROLE` is validated, unsafe pre-existing roles fail closed, and permission failures give an actionable diagnostic. | `src/core/postgres-role-bootstrap.test.ts` | Initial connection requires `CREATE ROLE`/`GRANT` capability. Runtime role DDL remains a production blocker until moved to controlled migration/provisioning. |
| Realtime postgres changes | Phoenix v2 join reply advertises bindings; REST INSERT/UPDATE/DELETE mutations emit matching `postgres_changes` payloads; subscription filter `tenant_id=eq.tenant-a` selects matching rows; a subscriber denied by the configured `canRead` callback receives no event. | `src/apis/realtime-postgres-changes.test.ts` | One Sinopebase process with its in-memory hub. The visibility test is a callback double, not a live PostgreSQL RLS/realtime-provider proof. |
| Storage HTTP | storage-js raw Buffer body and unnamed multipart File body upload; list returns raw objects; delete accepts `prefixes`; download is raw bytes; authenticated access fails closed when metadata policy support is absent; policy gets verified identity and upload metadata; cross-member read is hidden as 404; bucket MIME/size constraints reject invalid objects. | `src/apis/file.test.ts` | A request-context resolver plus a live `StorageAccessPolicy` backed by trusted metadata/policies. Service-role fallback is intentionally privileged. |

## Explicit boundaries and unproven claims

- This is a Sinope workload contract, not an implementation of all GoTrue, PostgREST, Realtime, or Storage APIs. In particular, do not infer support for OAuth/PKCE/MFA/email confirmation, RPC/OpenAPI/schema switching, full PostgREST filter/select grammar, composite/deep relationships, Realtime presence/durable channels, or Storage transformations/resumable uploads.
- Realtime is process-local. It publishes mutations routed through this process's PostgREST handlers only; writes by other processes and WAL/logical-replication capture are not implemented. It is not safe to scale to multiple replicas as a shared live-data feature.
- Storage currently buffers request bodies. The signed-URL endpoint produces an expiry query parameter, not a cryptographic signature. It must not be represented as a secure signed-URL capability.
- The focused storage-policy tests use a test policy implementation; they do not prove a deployed `storage` metadata schema, S3/MinIO/Netlify Blobs credentials, object-store consistency, or recovery behavior.
- The paired Sinope shim grants application table privileges and creates `SECURITY DEFINER` trigger functions. It is deliberately limited to the isolated experiment database and has not been reviewed as a portable production migration.
- Netlify Database and Netlify Blobs are outside this evidence. TLS, external connection behavior, role membership/`SET LOCAL ROLE`, migration authority, object credential rotation, consistency, ambiguous writes, backup/export, and restore remain provider probes/release blockers.
- The passed focused suite does not supersede the Wave 0 baseline: strict typecheck and the full test suite remain failing baseline gates. The current experiment contains known production security and operations blockers.

## Review and execution rules

1. Keep every row in the manifest mapped to an executable test or mark it `external-conditional`/`unproven`; do not turn an unproven provider capability into a passing local unit test.
2. Run the focused command above after edits to compatibility code. To execute the paired application contract, start an isolated Sinopebase instance and supply the three `SINOPEBASE_TEST_*` variables before running `bun run test:integration -- tests/integration/sinopebase-compat.test.ts` in `D:\Projects\sinope-sinopebase`.
3. Before enabling a new provider, add a provider-specific probe and update the corresponding manifest status/evidence. Production promotion requires independent security, migration, recovery, and multi-process Realtime evidence.
