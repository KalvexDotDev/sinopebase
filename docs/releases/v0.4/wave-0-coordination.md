# Sinopebase v0.4 Wave 0 Coordination

Date: 2026-07-22
Coordinator: root
Status: engaged

## Objective

Establish a truthful, reproducible release baseline before provider or security implementation begins. Existing user changes in both repositories are preserved. No deletion is authorized.

## Baseline

- Sinopebase head: `95b26b9182ac819730cf5952954a614942fd3eb5`
- Sinope experiment head: `8e7505f134d1c40d43780adea2d812af2adac0ff`
- Runtime: Bun `1.3.14`
- Production bundle: pass
- Strict typecheck: fail before source checking because the project-wide default include conflicts with `rootDir: ./src`, and TypeScript 7 rejects `baseUrl`
- Full suite: 1,157 pass, 21 fail, 2,035 assertions, 106 files
- Failure taxonomy: 20 Auth/PostgREST/Storage failures caused by stale listeners on fixed port 8090, plus one Windows shell stderr portability failure. On an OS-assigned port, auth passes and PostgREST separately exposes a PostgreSQL/RLS `permission denied for table todos` failure.
- Docker baseline: no `.dockerignore`; UI artifacts are assumed prebuilt; image tags are mutable; runtime is root and writable

## Ownership and Integration Order

| Work item | Model class | Exclusive write ownership | Integration order |
|---|---|---|---:|
| W0-A strict typecheck/version/changelog | frontier/complex | `tsconfig.json`, typecheck-only fixes explicitly reported before edits, `CHANGELOG.md` | 1 |
| W0-B deterministic test taxonomy/isolation | frontier/complex | new `tests/harness/**`, new test configuration files; no `package.json` or compatibility files | 2 |
| W0-C Sinope compatibility matrix/contract inventory | balanced/moderate | `docs/compatibility/**`, new `tests/contract/**`; no existing implementation files | 3 |
| W0-D clean pinned non-root container | balanced/moderate | `Dockerfile`, `.dockerignore`, new `docs/releases/v0.4/container-*`; no application or test files | 4 |

The coordinator alone owns `package.json`, `bun.lock`, shared scripts, evidence summaries, and integration across agent outputs. Agents must stop and report before touching any file outside their exclusive ownership.

## Gates

- Clean strict typecheck.
- Deterministic unit/component and infrastructure suites, with required infrastructure failing rather than silently skipping.
- Published Sinope compatibility matrix tied to permanent contract tests.
- Clean-context, pinned, non-root, read-only-capable container build with UI built inside the builder.
- Clean-clone release evidence records commands, versions, commit, environment prerequisites, results, timing, and skips.

## Current Status

| Work item | Status | Evidence / blocker |
|---|---|---|
| W0-A strict typecheck/version/changelog | In progress | TypeScript 7 config fixed; diagnostics reduced from 1,178 to 664 at the last coordinated count. Two independent reviews rejected unsafe database/file-store casts and a lifecycle race; corrective work is active. |
| W0-B deterministic test taxonomy/isolation | In progress | Harness/taxonomy green; all 107 tests classified; dynamic ports adopted in nine suites; full suite is 1,170 pass / 19 honest contract failures. Explicit infrastructure/resource namespaces remain. |
| W0-C compatibility matrix/contract | Complete for Wave 0 inventory | 49 focused tests / 121 assertions pass; matrix and machine-readable inventory published with unsupported/unproven boundaries. |
| W0-D clean pinned non-root container | Complete for Wave 0 build gate | No-cache digest-pinned build passes; binary and health run under UID/GID 10001, read-only root, dropped capabilities, and no-new-privileges. Secure boot remains Wave 1. |

## Evidence

See `docs/releases/v0.4/evidence/2026-07-22-engage-baseline.md`.
