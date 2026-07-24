# Engage Baseline Evidence

Captured: 2026-07-22 UTC
Workspace: `D:\Projects\sinopebase`

## Repository State

- Head: `95b26b9182ac819730cf5952954a614942fd3eb5`
- Branch: `master`
- Worktree was already dirty at engagement. The tracked experimental compatibility diff contains 1,437 additions and 265 deletions across 15 files, plus untracked compatibility tests and helpers.
- The paired Sinope experiment at `D:\Projects\sinope-sinopebase` was also already dirty and was not modified during baseline capture.

## Commands and Results

| Command | Result |
|---|---|
| `bun --version` | `1.3.14` |
| `bun run typecheck` | failed: TS6059 project discovery/rootDir errors and TS5102 removed `baseUrl` |
| `bun test` | failed: 1,157 passed, 21 failed, 2,035 assertions across 106 files in 7.10s |
| `bun run build` | passed: 1,126 modules bundled; `dist/serve.js` 3.69 MB |

## Failure Classification

- Test-isolation defects: Auth 2, PostgREST 16, and Storage 2 were contaminated by two pre-existing Bun listeners on fixed port 8090. Focused reruns were not isolated because their clients still targeted that occupied port. On an OS-assigned port, fresh signup, get-user, and refresh pass.
- Product/security defect exposed after isolation: a unique-port PostgREST anon read reaches the intended server but returns HTTP 500 with PostgreSQL `permission denied for table todos`, requiring an explicit schema privilege/RLS contract decision and regression test.
- Portability/test defect: `src/tools/osutils/run.test.ts` assumes POSIX `sh -c` behavior while running on Windows.
- Configuration defect: TypeScript scans multiple repository roots and generated UI output while declaring `rootDir: ./src`; TypeScript 7 no longer accepts `baseUrl`.

This is baseline evidence, not a completed release gate. A clean-clone rerun is required after Wave 0 integration.

## Original HEAD Clean-Clone Baseline

A retained local clone was created at `D:\tmp\sinopebase-v04-clean-head-95b26b9` from commit `95b26b9182ac819730cf5952954a614942fd3eb5`; `git status` was clean and `bun install --frozen-lockfile` installed 203 packages successfully.

| Command | Clean-HEAD result |
|---|---|
| `bun run typecheck` | failed at the original TS6059 `rootDir` discovery and TypeScript 7 TS5102 `baseUrl` errors |
| `bun test` | 1,120 passed, 19 failed, one timeout/error, 1,943 assertions across 98 files in 15.05s; fixed port 8090 was contaminated by pre-existing listeners |
| `bun run build` | passed: 1,123 modules bundled; `dist/serve.js` 3.65 MB |

The clone and its generated dependency/build artifacts are retained because deletion was not authorized. This establishes the official HEAD baseline; a second clean-clone gate from an integrated/committed Wave 0 revision is still required.

## Wave 0-A Configuration Follow-up

The TypeScript 7 configuration blocker was corrected by widening `rootDir` to the repository root and removing the deleted `baseUrl` option while retaining strict flags and the `~/*` path mapping. Type checking now reaches the actual program and reports 1,178 strict errors across 179 files. This is newly exposed source debt, not a regression introduced by the configuration change, and remains an open Wave 0 gate.

## Wave 0-D Container Follow-up

The clean, no-cache container build now passes from digest-pinned Dockerfile frontend, Bun builder, and Alpine runtime images. The admin UI is built inside the builder, the compiled server runs as UID/GID 10001 under a read-only root with all capabilities dropped, and `/api/health` returns HTTP 200. Runtime testing caught and corrected two issues that static inspection missed: an ineffective Bun `--cwd` invocation and missing dynamic `libgcc`/`libstdc++` dependencies. The health payload still proves the production fail-closed gate is open because an unconfigured container reports memory database and local storage fallbacks.

## Wave 0-B Test Foundation Follow-up

The new harness provides OS-held loopback port reservations, deterministic PostgreSQL/schema/bucket/temp namespaces, fail-by-default infrastructure gates, shell-free Windows fixtures, an eight-suite taxonomy, and a machine-audited hazard inventory. Validation passes: 11 harness tests, 220 port-reservation stress iterations, focused strict typecheck, and an audit classifying all 107 test files exactly once with 25 current reviewed hazards and no gaps/stale entries. The Windows stderr test now passes 5/5 with the portable fixture. Nine server-backed suites now use distinct dynamic ports. Their combined result is 48 pass / 19 fail: Auth, better-auth, PostgreSQL RLS, DropFunctions, and Mastra pass; the honest remaining failures are PostgREST 16, Storage 2, and Realtime 1.

After integration, a full `bun test` run reports 1,170 passed / 19 failed, 2,068 assertions across 107 files in 7.10s. The failure set matches the isolated contract groups above; there are no Windows stderr or stale-listener credential failures.

## Wave 0-A Strict-Type Follow-up

After bounded configuration, core model/event/query, application, HTTP infrastructure, macro-test, and portability slices, strict diagnostics have fallen from 1,178 across 179 files to 664 across 166 files. The work also fixed a real runtime collision where `Sinopebase`'s `db` instance field shadowed `BaseApp.db()`. Shared interface mismatches exposed during remediation remain tracked rather than hidden as completion: database DDL/select signatures, local file-store save return type, and Elysia TLS listen behavior.

Two independent security/correctness reviews rejected the initial `app.ts` strict-type slice while accepting the `db` backing-field rename. Reproductions show the new database/file-store double assertions conceal runtime-incompatible interfaces, and the local server lifecycle rewrite can orphan a listening server when `stop()` races an in-flight `start()`. Corrective lifecycle, shutdown, and truthful contract work is in progress; this slice is not accepted evidence yet. The reviews also reconfirmed pre-existing P0 blockers in default credentials/auth fallback, owner-level service execution, and Realtime authorization/projection.
