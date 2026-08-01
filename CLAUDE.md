# Sinopebase — Claude Code Instructions

## Memento

**Before every commit**, update the relevant memento file(s) in `C:\Users\Jaimie\memento\`:
- New patterns/decisions → create or update a `sinopebase-*-patterns.md` file
- Status changes → update `sinopebase-layer-status.md`
- Feature completion → update `sinopebase-v0.2-status.md` (or create for new versions)
- Link related mementos with `[[filename]]` syntax
- Update `MEMORY.md` index at `C:\Users\Jaimie\.claude\projects\D--Projects-sinopebase\memory\MEMORY.md`

**At the start of every task**, search the memento for relevant context:
- Read `C:\Users\Jaimie\memento\sinopebase-layer-status.md` for current project state
- Search `C:\Users\Jaimie\memento\` for `sinopebase-*` files matching the task domain
- Apply established patterns and decisions from memento files before writing code

## Project Conventions

### Code
- TypeScript strict mode (`tsconfig.json` — `"strict": true`)
- Use `~/` path aliases (maps to `src/`), not relative paths
- Elysia for HTTP, Kysely for SQL, better-auth for authentication
- Bun runtime (`bun test`, `bun run`)

### Testing
- Test-first: write ATDD tests before implementation
- Tests run against real infrastructure (PostgreSQL + RustFS in Docker)
- Test files mirror source structure under `tests/`
- `bun test` must pass with 0 failures before any commit

### Git
- Atomic commits per phase/layer
- Commit messages: `phase/domain: what changed`
- End with `Co-Authored-By: Claude <noreply@anthropic.com>`
- Tag milestones (`v0.1.0`, `v0.2.0`, etc.)

### Review
- After every significant change: `/code-review`, `/security-review`, `/simplify`
- Fix all confirmed findings before tagging

### Pre-Push Checklist (run before `git push`)
1. **`bun run ci:quick`** — format, lint, typecheck regression gate (fast, no Docker needed)
2. **`bun test`** — full test suite (needs Docker PostgreSQL + RustFS). At minimum, run the tests for the domain you changed.
3. **`bun run build`** — backend compiles; `cd ui && bun run build` — admin UI compiles
4. **Typecheck baseline**: if you introduce or fix TS errors, run `bun run tsc --noEmit 2>&1 > typecheck-baseline.txt` to update the baseline BEFORE pushing. The CI gate diffs against this file.

### Common CI Pitfalls
- **Biome version**: use `./node_modules/.bin/biome`, never `npx biome` (resolves to wrong global version). The project scripts (`bun run format`, `bun run lint`) use the correct version automatically.
- **`typecheck` vs `typecheck:ci`**: `bun run typecheck` just runs tsc. `bun run typecheck:ci` diffs against the baseline and fails on NEW errors. Use `typecheck:ci` before pushing.
- **GHCR requires lowercase**: Docker tags must be all lowercase. Use `tr '[:upper:]' '[:lower:]'` for org/repo names with capitals.
- **Rate limit defaults**: the server defaults to 1000 req/min. Tests that set explicit `rateLimitMax` are unaffected. Path exemptions (`/api/admin/*`, `/api/logs`, `/api/health`, `/api/ready`) skip rate limiting.
- **`Record<string, unknown>` breaks property access**: pg row types need proper interfaces, not loose records. Define `interface XxxRow { ... }` and use `pool.query<XxxRow>(...)`.

## Architecture

- PocketBase v0.25.x 1:1 port (Go → TypeScript)
- 5-layer architecture: tools → core → forms → apis → entry-points
- Plugin pattern: `class Plugin { constructor(options) {} async register(app, auth?) {} }`
- Dual auth: better-auth (PostgreSQL) or in-memory jose (dev without PG)
- SDK: thin supabase-js compatible wrapper at `src/sdk/`

## Memento Files

Key memento files at `C:\Users\Jaimie\memento\`:
- `sinopebase-layer-status.md` — current metrics and layer progress
- `sinopebase-architecture-v2.md` — system architecture
- `sinopebase-porting-patterns.md` — Go→TS conversion patterns
- `sinopebase-v0.2-patterns.md` — v0.2 decisions and conventions
- `sinopebase-v0.2-status.md` — v0.2 feature breakdown
- `sinopebase-motivation.md` — project rationale
- `sinopebase-risks.md` — known risks
