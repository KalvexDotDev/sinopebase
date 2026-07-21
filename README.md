# ⚡ Sinopebase

**PocketBase-shaped, Supabase-compatible. TypeScript. Bun. PostgreSQL.**

Drop-in replacement for supabase-js. Swap the URL and keep your frontend code. Backed by PocketBase v0.25.x architecture, ported 1:1 from Go to TypeScript.

```ts
// Your frontend code doesn't change
import { createClient } from 'sinopebase'

const sb = createClient('https://sinopebase.example.com', 'your-anon-key')

const { data } = await sb.from('todos').select('*')
const { data: { user } } = await sb.auth.signUp({ email, password })
const { data } = await sb.functions.invoke('hello', { body: { name: 'World' } })
```

## Why

| | Supabase | Sinopebase |
|---|----------|------------|
| **Self-host** | $450/mo enterprise | Free, open-source |
| **Runtime** | Deno | Bun |
| **Auth** | GoTrue | better-auth v1.6 |
| **SDK** | supabase-js | Drop-in compatible |
| **Edge Functions** | Deno deploy | Bun Worker sandbox |
| **AI** | Mastra (hosted) | Mastra agents + MCP tools |
| **Storage** | S3 | RustFS / MinIO / S3 |
| **Tests** | — | 1,139 tests, 0 failures |

## Quick Start

```bash
git clone https://github.com/sinopebase/sinopebase
cd sinopebase
docker compose up -d     # PostgreSQL + RustFS + PgBouncer
bun install
bun run dev              # → http://localhost:8090
open http://localhost:8090/_/  # Admin UI
```

## SDK Parity

| supabase-js | Sinopebase |
|---|---|
| `.from('table').select()` | ✅ |
| `.from('table').insert()` | ✅ |
| `.auth.signUp()` / `signInWithPassword()` | ✅ |
| `.auth.getUser()` / `signOut()` | ✅ |
| `.storage.from().upload()` / `download()` | ✅ |
| `.channel().subscribe()` | ✅ |
| `.functions.invoke()` | ✅ |

## Architecture

```
sinopebase/
├── src/sdk/          Supabase-compatible client wrapper
├── src/core/         PocketBase v0.25.x port (~105 files)
├── src/tools/        Utilities: auth, filesystem, cron, mailer, search
├── src/apis/         Route handlers: REST, auth, storage, realtime
├── src/plugins/      DropFunctions, Mastra AI, Backup, Metrics, Logs
├── ui/               Svelte 5 Admin SPA
└── tests/            98 files, 1139 tests
```

## Docs

- [Getting Started](docs/getting-started.md)
- [Auth & SSO](docs/auth.md)
- [Edge Functions](docs/edge-functions.md)
- [AI & Mastra](docs/ai.md)
- [API Reference](docs/api.md)
- [Deployment](docs/deployment.md)

## License

MIT
