# ⚡ Sinopebase

[![CI](https://github.com/sinopebase/sinopebase/actions/workflows/ci.yml/badge.svg)](https://github.com/sinopebase/sinopebase/actions/workflows/ci.yml)
[![Supply Chain Security](https://github.com/sinopebase/sinopebase/actions/workflows/supply-chain.yml/badge.svg)](https://github.com/sinopebase/sinopebase/actions/workflows/supply-chain.yml)

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

## Deploy to Railway

Deploy Sinopebase to Railway in one click with automatic HTTPS, PostgreSQL, and CI/CD.

### One-Click Deploy

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new?template=https%3A%2F%2Fgithub.com%2Fsinopebase%2Fsinopebase)

### Manual Deploy

1. **Install the Railway CLI** (if deploying from your machine):
   ```bash
   bash <(curl -fsSL railway.com/install.sh) -y
   ```

2. **Log in and link your project:**
   ```bash
   railway login
   railway link
   ```

3. **Set required environment variables** in your Railway service dashboard or via CLI:
   ```bash
   railway variables --set JWT_SECRET=$(openssl rand -hex 32)
   railway variables --set SINOPEBASE_SERVICE_ROLE_KEY=$(openssl rand -hex 32)
   railway variables --set SINOPEBASE_ANON_KEY=$(openssl rand -hex 32)
   railway variables --set MASTRA_REQUIRE_AUTH=true
   ```

   See `.env.railway` for the complete list of all supported variables.

4. **Deploy:**
   ```bash
   railway up
   ```

### Required Secrets (GitHub Actions)

Add these secrets to your GitHub repository (`Settings > Secrets and variables > Actions`):

| Secret | Description |
|--------|-------------|
| `RAILWAY_TOKEN` | Railway project token (create in Railway Dashboard > Project > Tokens) |
| `RAILWAY_API_TOKEN` | Railway account token (for PR preview environments; create in Railway Dashboard > Account > Tokens) |
| `SINOPEBASE_SERVICE_ROLE_KEY` | Service role key for admin operations |
| `SINOPEBASE_ANON_KEY` | Anonymous key for public operations |
| `JWT_SECRET` | JWT signing secret (min 32 characters) |

### Required Variables (GitHub Actions)

Add these variables to your GitHub repository (`Settings > Secrets and variables > Actions`):

| Variable | Description |
|----------|-------------|
| `RAILWAY_STAGING_URL` | Your Railway staging service URL (e.g., `sinopebase-production.up.railway.app`) |
| `RAILWAY_SOURCE_ENV_ID` | Railway environment ID to copy for PR previews |
| `RAILWAY_SERVICE_ID` | Railway service ID for preview configuration |

### CI/CD Pipeline

The `.github/workflows/ci.yml` pipeline runs:
1. **test** — lint, typecheck, test suite, and build
2. **docker** — build Docker image and scan with Trivy (CRITICAL/HIGH)
3. **deploy-staging** — deploy to Railway on `master`/`main` pushes
4. **deploy-preview** — deploy ephemeral preview environments on pull requests
5. **cleanup-preview** — tear down preview environments when PRs close
6. **smoketest** — verify `/api/health` and `/api/ready` endpoints on staging

### Railway Configuration

Sinopebase includes a `railway.toml` that configures Railway to use the project's Dockerfile for building, health-check against `/api/health`, and restart on failure. The service listens on port 8090 as defined in the Dockerfile.

### Environment Template

Copy `.env.railway` for a complete reference of all supported environment variables, including database, auth, storage, and AI configuration options.

## License

MIT
