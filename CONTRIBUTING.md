# Contributing to Sinopebase

Thanks for your interest. Sinopebase follows **acceptance test-driven development (ATDD)** — every feature starts as a failing test that exercises real infrastructure.

## Quick Links

- [Security vulnerabilities → SECURITY.md](SECURITY.md) — do NOT open a public issue
- [Code of Conduct → CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- [Architecture → docs/development.md](docs/development.md)

## Development Setup

```bash
bun install
docker compose up -d          # PostgreSQL + RustFS
bun run dev                   # → http://localhost:8090
```

## Quality Gates (must pass before PR)

```bash
bun test                      # Full suite
bun run typecheck             # tsc --noEmit (strict mode)
bun run lint                  # Biome + ESLint
bun run ci                    # All gates
```

## How to Contribute

### 1. Find or open an issue

All PRs should reference an issue. If you're fixing something without an issue, open one first so we can discuss the approach.

### 2. Write the test first

Sinopebase tests run against real PostgreSQL + RustFS in Docker. No mocks, no SQLite stand-ins.

- Contract tests: `tests/integration/` — HTTP-level, exercise the full stack
- Component tests: `tests/integration/app-lifecycle.test.ts` — app-level
- Unit tests: co-located with source (`src/**/*.test.ts`)

```bash
# Run a specific test file
bun test tests/integration/auth.test.ts

# Run a specific test pattern
bun test --test-name-pattern "signInWithPassword"
```

### 3. Implement

Code style:
- TypeScript strict mode — no `any`, no implicit returns
- Use `~/` path aliases (maps to `src/`), not relative paths
- Elysia for HTTP, Kysely for SQL
- Match the existing pattern — look at surrounding code

### 4. Open a PR

- Reference the issue number (`Closes #123`)
- Describe what changed and why
- Confirm `bun run ci` passes locally
- Wait for CI to complete (all 9 quality gates must be green)

## Architecture

Five layers, each testable in isolation:

```
entry-points → apis → forms → core → tools
```

- **tools** — low-level primitives (auth providers, file stores, DB adapters, mailers)
- **core** — domain logic (collections, records, fields, events, hooks, cron)
- **forms** — request/response validation and transformation
- **apis** — HTTP route definitions (REST, Auth, Realtime, Storage, Functions)
- **entry-points** — the CLI server binary and plugin wiring

See [docs/development.md](docs/development.md) for the full architecture guide.

## Commit Conventions

```
phase/domain: what changed

Co-Authored-By: Claude <noreply@anthropic.com>
```

Examples:
- `core/rls: fix SET LOCAL ROLE in transaction context`
- `apis/postgrest: add head count support with content-range header`
- `ui/table-editor: fix CSV export for empty columns`

## Project Conventions

- **Tests first.** No PR merges without passing tests.
- **Atomic commits.** One concern per commit. Don't mix refactoring with features.
- **Plugin pattern.** New subsystems use `class Plugin { constructor(options) {} async register(app, auth?) {} }`.
- **No silent failures.** Errors propagate. `try {}` blocks always have explicit handling.

## Review Process

1. CI must pass (all 9 gates: test, typecheck, lint, build, UI build, Docker, SAST, dependency audit, container scan)
2. One maintainer review required
3. No lingering TODOs in touched code (replace with tracked issues)

## Getting Help

- [GitHub Issues](https://github.com/sinopebase/sinopebase/issues) for bugs and feature requests
- [GitHub Discussions](https://github.com/sinopebase/sinopebase/discussions) for questions and ideas

---

Thanks for contributing. Ship carefully.
