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

Open `http://localhost:8090/_/` in your browser.

**Sign in with your service role key** (set via `SINOPEBASE_SERVICE_ROLE_KEY` env var). The admin dashboard provides:

- **Table Editor** — browse, filter, sort, edit, import/export data
- **Auth Users** — manage users, reset passwords, view sessions
- **Storage** — upload, download, manage files and buckets
- **API Docs** — auto-generated curl + JS examples
- **Realtime Inspector** — monitor WebSocket connections
- **Backups** — create, restore, and schedule backups
- **Metrics** — request rate, latency, errors dashboard
- **Logs** — server-side request log viewer
- **AI Playground** — chat with Mastra agents

### Running with TLS (HTTPS)

```bash
# Generate a self-signed certificate for local development
bash scripts/gen-dev-cert.sh

# Start with TLS
bun run cmd/serve.ts --tls-cert dev-certs/cert.pem --tls-key dev-certs/key.pem

# The server now listens on HTTPS (port 8090) with HTTP→HTTPS redirect on port 80
```

For production, TLS is automatically handled by Railway's edge proxy — no app-level TLS configuration is needed. See [Deployment](deployment.md) for details.

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
