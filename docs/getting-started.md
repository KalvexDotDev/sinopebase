# Getting Started

## Prerequisites

- [Bun](https://bun.com) ≥ 1.3
- [Docker](https://docker.com) (for PostgreSQL + RustFS)

## 1. Clone & Start Infrastructure

```bash
git clone https://github.com/sinopebase/sinopebase
cd sinopebase
docker compose up -d
```

This starts:
- PostgreSQL 18 on `localhost:5432`
- RustFS (S3-compatible) on `localhost:9000`
- PgBouncer on `localhost:6432` (optional)

## 2. Install & Run

```bash
bun install
bun run dev
```

```
Database: PostgreSQL connected
Auth: better-auth initialized (PostgreSQL)
Storage: S3 (localhost:9000)
Sinopebase serving on http://127.0.0.1:8090
```

## 3. Connect Your App

```ts
import { createClient } from 'sinopebase'

const sb = createClient('http://localhost:8090', 'your-anon-key')

// Test the connection
const { data } = await sb.from('todos').select('*')
console.log(data)
```

## 4. Admin UI

Open `http://localhost:8090/_/` — login, manage collections, browse records,
deploy edge functions, and interact with AI agents.

## Project Structure

```
my-project/
├── functions/        # Edge functions (auto-watched)
│   └── hello.ts
├── pb_data/          # Local storage (when not using S3)
└── sinopebase.config.ts  # Optional config file
```

## Using as a Library

```ts
import { Sinopebase, DropFunctionsPlugin, MastraPlugin } from 'sinopebase'

const app = new Sinopebase({
  port: 8090,
  postgresUrl: 'postgresql://localhost:5432/mydb',
  jwtSecret: process.env.JWT_SECRET,
  oauthProviders: [
    { providerId: 'google', clientId: '...', clientSecret: '...' },
  ],
})

// Plugins
const functions = new DropFunctionsPlugin({ functionsDir: './my-fns' })
await functions.register(app.server, app.getAuth())

const ai = new MastraPlugin({ openaiApiKey: process.env.OPENAI_API_KEY })
await ai.register(app.server, app.getAuth(), app.getDatabase(), app.getFileStore())

await app.start()
```

## Next Steps

- [Auth & SSO](auth.md) — email/password, OAuth, enterprise SSO
- [Edge Functions](edge-functions.md) — deploy and manage functions
- [AI & Mastra](ai.md) — agents, tools, streaming
- [API Reference](api.md) — REST API endpoints
- [Deployment](deployment.md) — production setup
