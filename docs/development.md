# Development Guide

## Architecture

Sinopebase follows a 5-layer architecture ported 1:1 from PocketBase v0.25.x (Go → TypeScript):

```
Layer 5: entry-points/   — CLI, server startup, graceful shutdown
Layer 4: apis/           — Route handlers, middleware, REST/WS endpoints
Layer 3: forms/          — Request validation and data binding
Layer 2: core/           — App, collections, records, fields, events, hooks
Layer 1: tools/          — Auth providers, filesystem, cron, mailer, search
Layer 0: types/          — Shared TypeScript types and interfaces
```

### Key Technologies

| Technology | Purpose |
|---|---|
| [Bun](https://bun.sh) | Runtime, bundler, test runner |
| [Elysia](https://elysiajs.com) | HTTP framework (type-safe, fast) |
| [Kysely](https://kysely.dev) | SQL query builder (type-safe) |
| [better-auth](https://www.better-auth.com) | Authentication (embedded) |
| [Svelte 5](https://svelte.dev) | Admin UI (runes mode) |
| [pg](https://node-postgres.com) | PostgreSQL driver |

### Directory Structure

```
sinopebase/
├── cmd/serve.ts              # CLI entry point
├── src/
│   ├── sdk/                  # supabase-js compatible client
│   ├── core/                 # PocketBase core (~105 files)
│   │   ├── app.ts            # Main application class
│   │   ├── collection_model.ts
│   │   ├── db-postgres.ts    # PostgreSQL adapter
│   │   ├── db-memory.ts      # In-memory adapter (dev/testing)
│   │   └── ...
│   ├── apis/                 # Route handlers
│   │   ├── postgrest.ts      # REST API
│   │   ├── auth.ts           # Auth routes
│   │   ├── realtime.ts       # WebSocket + Phoenix Channels
│   │   ├── realtime-pg-listener.ts  # PG LISTEN/NOTIFY fan-out
│   │   ├── file.ts           # Storage routes
│   │   └── ...
│   ├── plugins/              # Plugin system
│   │   ├── drop-functions/   # Edge Functions (Bun Workers)
│   │   ├── mastra/           # AI agents
│   │   └── metrics/          # Metrics collection
│   ├── tools/                # Utility modules
│   ├── migrations/           # Database migrations
│   └── ui/                   # Admin UI embed stubs
├── ui/                       # Svelte 5 Admin SPA
│   ├── src/
│   │   ├── pages/            # Page components
│   │   ├── components/       # Reusable components
│   │   ├── lib/              # API client, router
│   │   └── styles/           # Cairn design system CSS
│   └── dist/                 # Built SPA (served at /_/)
├── tests/                    # Test suites
│   ├── integration/          # Full integration tests
│   ├── harness/              # Test infrastructure
│   └── contract/             # Compatibility contract tests
├── docker-compose.yml        # Local dev infrastructure
├── Dockerfile                # Production container
├── railway.toml              # Railway deploy config
└── design.md                 # Cairn design system spec
```

## Conventions

### Code Style

- TypeScript strict mode (`"strict": true`)
- Use `~/` path aliases (maps to `src/`), not relative paths
- Elysia `const` chain pattern (never `let` reassignment)
- Prefer explicit return types on public APIs
- No `any` — use `unknown` and narrow

### Testing

- **Test-first**: Write ATDD tests before implementation
- Tests run against real infrastructure (PostgreSQL + RustFS in Docker)
- Test files mirror source structure under `tests/`
- `bun test` must pass with 0 failures before any commit

### Git

- Atomic commits per phase/layer
- Commit messages: `phase/domain: what changed`
- End with `Co-Authored-By: Claude <noreply@anthropic.com>`
- Tag milestones (`v0.4.0`, `v0.5.0`, etc.)

### Naming

- Files: `snake_case.ts` for ported code, `kebab-case.ts` for new code
- Classes: PascalCase
- Functions: camelCase
- Constants: UPPER_SNAKE_CASE

## Getting Started

```bash
# Prerequisites
# - Bun >= 1.0
# - Docker (for PostgreSQL + RustFS)

# Clone and install
git clone https://github.com/sinopebase/sinopebase
cd sinopebase
bun install

# Start test infrastructure
docker compose up -d

# Run tests
bun test

# Start dev server
bun run dev

# Admin UI dev server
cd ui && bun install && bun run dev
```

## Writing Tests

```ts
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { Sinopebase } from '~/core/app'

describe('My Feature', () => {
  let app: Sinopebase

  beforeAll(async () => {
    app = new Sinopebase({
      postgresUrl: process.env.POSTGRES_URL,
      jwtSecret: 'test-secret-32-chars-minimum!!',
      serviceRoleKey: 'test-service-role-key-32-chars!!',
      anonKey: 'test-anon-key-32-chars-minimum!!',
    })
    await app.start()
  })

  afterAll(async () => {
    await app.stop()
  })

  test('does the thing', async () => {
    const response = await fetch('http://localhost:8090/api/health')
    expect(response.status).toBe(200)
  })
})
```

## Admin UI Development

```bash
cd ui

# Install dependencies
bun install

# Dev server with hot reload (proxies API to localhost:8090)
bun run dev

# Production build
bun run build
# Output: ui/dist/ → served by Sinopebase at /_/
```

The Admin UI uses:
- **Svelte 5** with runes (`$state`, `$derived`, `$effect`, `$props`)
- **Cairn design system** — see `design.md` for the full spec
- **Hash-based routing** — `window.location.hash`
- **Service role key auth** — stored in `localStorage` as `sb-service-role-key`

### Adding a New Page

1. Create `ui/src/pages/MyPage.svelte`
2. Add route to `ui/src/lib/router.ts`
3. Add import and route branch to `ui/src/App.svelte`

## CI/CD Pipeline

Run locally before pushing:

```bash
bun run ci
```

This executes:
1. `bun audit` — dependency scanning
2. `bun run format:check` — Biome format
3. `bun run lint` — Biome + ESLint
4. `bun run lint:jscpd` — copy-paste detection
5. `bun run typecheck` — TypeScript strict
6. `bun test` — full test suite
7. `bun run build` — production build

## Release Process

1. Ensure all tests pass: `bun test`
2. Run CI locally: `bun run ci`
3. Update version in `package.json`
4. Update mementos in `C:\Users\Jaimie\memento\`
5. Commit with tag: `git tag v0.X.0 && git push origin v0.X.0`
6. Deploy via Railway or Docker

## Related

- [Architecture](https://github.com/sinopebase/sinopebase/blob/main/docs/architecture.md)
- [Design System](https://github.com/sinopebase/sinopebase/blob/main/design.md)
- [API Reference](https://github.com/sinopebase/sinopebase/blob/main/docs/api.md)
