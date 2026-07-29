<p align="center">
  <img src="https://raw.githubusercontent.com/sinopebase/sinopebase/main/docs/assets/wordmark.svg" alt="Sinopebase" width="480" />
</p>

<p align="center">
  <strong>PocketBase-shaped, Supabase-compatible. TypeScript. Bun. PostgreSQL.</strong>
</p>

<p align="center">
  <a href="https://github.com/sinopebase/sinopebase/actions/workflows/ci.yml"><img src="https://github.com/sinopebase/sinopebase/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/sinopebase/sinopebase/actions/workflows/supply-chain.yml"><img src="https://github.com/sinopebase/sinopebase/actions/workflows/supply-chain.yml/badge.svg" alt="Supply Chain" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License" /></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-Bun-%23fbf0df?logo=bun" alt="Bun" /></a>
  <img src="https://img.shields.io/badge/tests-1312%2F0%20pass-brightgreen" alt="Tests" />
  <img src="https://img.shields.io/badge/coverage-122%20files-blue" alt="Coverage" />
</p>

---

<p align="center">
  <strong>Drop-in replacement for supabase-js.</strong> Swap the URL, keep your frontend code.
  <br/>
  Backed by PocketBase v0.25.x architecture — ported 1:1 from Go to TypeScript.
  <br/>
  <strong>One binary. PostgreSQL. S3. Real-time. Edge Functions. AI.</strong>
</p>

---

## 🚀 Why Sinopebase?

| | Supabase Cloud | Sinopebase |
|---|:---:|---|
| **License** | Proprietary (hosted) | MIT — truly open-source |
| **Self-host** | Enterprise ($450/mo+) | Free, single binary |
| **Runtime** | Deno | **Bun** — 4× faster startup |
| **Auth** | GoTrue | **better-auth v1.6** — modern, typed |
| **SDK** | supabase-js | Drop-in compatible |
| **Edge Functions** | Deno Deploy | Bun Worker sandbox |
| **AI / Agents** | — | Mastra agents + MCP tools |
| **Admin UI** | Supabase Studio | Svelte 5 SPA with Cairn design |
| **Storage** | S3 | RustFS / MinIO / S3 |
| **Realtime** | Phoenix Channels | Phoenix Channels + PG NOTIFY fan-out |
| **Database** | PostgreSQL | PostgreSQL (Kysely) |
| **TLS** | Cloud-managed | Bun-native + LetsEncrypt |
| **Tests** | — | **1,312 tests, 0 failures, 122 files** |

## ✨ Features

```
✅ Supabase-js compatible SDK        ✅ REST API (PostgREST-compatible)
✅ better-auth (email, OAuth, SSO)   ✅ PostgreSQL via Kysely
✅ Real-time WebSocket subscriptions  ✅ PG LISTEN/NOTIFY cross-process fan-out
✅ Svelte 5 Admin UI (Cairn design)   ✅ Edge Functions (Bun Workers)
✅ Mastra AI agents + MCP tools       ✅ Storage (S3, MinIO, RustFS, local)
✅ Backup & restore                   ✅ Cron scheduler + Mailer
✅ TLS (Bun-native + LetsEncrypt)     ✅ Rate limiting + CORS
✅ Migrations (timestamped)           ✅ RLS (Row-Level Security)
✅ HSTS + security headers            ✅ Metrics + structured logging
✅ Docker / Railway deploy            ✅ CI/CD with quality gates
```

## 📦 Quick Start

```bash
# Clone and start
git clone https://github.com/sinopebase/sinopebase
cd sinopebase
docker compose up -d          # PostgreSQL + RustFS
bun install
bun run dev                   # → http://localhost:8090

# Admin UI
open http://localhost:8090/_/  # Sign in with your service_role key

# Or run with TLS
bash scripts/gen-dev-cert.sh
bun run cmd/serve.ts --tls-cert dev-certs/cert.pem --tls-key dev-certs/key.pem
```

## 💻 SDK — Drop-in supabase-js Replacement

```ts
import { createClient } from 'sinopebase'

const sb = createClient('https://sinopebase.example.com', 'your-anon-key')

// Database
const { data } = await sb.from('todos').select('*')
const { data } = await sb.from('todos').insert({ title: 'Ship v0.5' })

// Auth
const { data: { user } } = await sb.auth.signUp({ email, password })
const { data: { user } } = await sb.auth.signInWithPassword({ email, password })

// Storage
const { data } = await sb.storage.from('avatars').upload('photo.png', file)
const { data } = await sb.storage.from('avatars').download('photo.png')

// Realtime
const channel = sb.channel('room-1')
channel.on('broadcast', { event: 'message' }, (payload) => console.log(payload))
channel.subscribe()

// Edge Functions
const { data } = await sb.functions.invoke('hello', { body: { name: 'World' } })

// AI
const { data } = await sb.functions.invoke('chat', { body: { messages: [...] } })
```

## 🎨 Admin UI

Sinopebase ships with a complete **Supabase Studio-compatible** admin dashboard at `/_/`:

- **Table Editor** — browse, filter, sort, edit, import/export
- **Auth Users** — create, delete, reset passwords, view sessions
- **Storage** — bucket browser, file upload/download
- **RLS Policies** — per-table policy viewer
- **API Docs** — auto-generated curl + JS examples
- **Realtime Inspector** — live WebSocket monitor
- **Backups** — create, restore, schedule
- **Metrics** — request rate, latency, errors, DB pool
- **AI Playground** — Mastra agent chat
- **Logs** — server-side request log viewer

All built in the **[Cairn](design.md)** design system — editorial dark, Cormorant Garamond + Inter typography, one mint accent.

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Your Frontend                      │
│              import { createClient }                 │
│                 from 'sinopebase'                    │
└─────────────────────┬───────────────────────────────┘
                      │ supabase-js compatible SDK
┌─────────────────────▼───────────────────────────────┐
│                 Sinopebase Core                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────────┐ │
│  │ REST API │ │ Auth API │ │ Realtime (WS + PG)   │ │
│  │ /rest/v1 │ │ /auth/v1 │ │ /realtime/v1         │ │
│  └────┬─────┘ └────┬─────┘ └──────────┬───────────┘ │
│       │            │                  │              │
│  ┌────▼────────────▼──────────────────▼───────────┐ │
│  │              Core Layer                         │ │
│  │  Collections · Records · Fields · Events       │ │
│  │  Hooks · Cron · Mailer · Migrations            │ │
│  └────────────────────┬───────────────────────────┘ │
│                       │                              │
│  ┌────────────────────▼───────────────────────────┐ │
│  │              Data Layer                         │ │
│  │  PostgreSQL (Kysely) · S3/MinIO/RustFS         │ │
│  │  better-auth · PG LISTEN/NOTIFY                │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  ┌──────────┐ ┌──────────┐ ┌─────────────────────┐  │
│  │ Mastra AI│ │Edge Funcs│ │   Admin UI (Svelte)  │  │
│  │ /api/    │ │ /api/    │ │   /_/                │  │
│  │ mastra/* │ │ funcs/v1 │ │                      │  │
│  └──────────┘ └──────────┘ └─────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

## 🔒 Security

- **Timing-safe key comparison** (`crypto.timingSafeEqual`)
- **HSTS** (`Strict-Transport-Security`) with TLS
- **Hairline auth borders** — service_role, anon, authenticated
- **Rate limiting** — configurable per-endpoint
- **CORS** — whitelist origins, no wildcards in production
- **RLS** — PostgreSQL Row-Level Security with request context
- **Path-traversal protection** — admin UI file serving
- **Secret masking** — API keys hidden in admin UI
- **Pre-commit Gitleaks** — secrets never reach git history
- **Trivy container scanning** — CRITICAL+HIGH gates in CI

## 🚢 Deploy

### Railway (recommended)

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new?template=https%3A%2F%2Fgithub.com%2Fsinopebase%2Fsinopebase)

```bash
railway login
railway link
railway variables --set JWT_SECRET=$(openssl rand -hex 32)
railway variables --set SINOPEBASE_SERVICE_ROLE_KEY=$(openssl rand -hex 32)
railway variables --set SINOPEBASE_ANON_KEY=$(openssl rand -hex 32)
railway up
```

TLS is terminated at Railway's edge — no app-level TLS needed. See `.env.railway` for the complete variable reference.

### Docker

```bash
docker build -t sinopebase .
docker run -p 8090:8090 \
  -e POSTGRES_URL=postgres://... \
  -e JWT_SECRET=$(openssl rand -hex 32) \
  -e SINOPEBASE_SERVICE_ROLE_KEY=$(openssl rand -hex 32) \
  sinopebase
```

### Bare Metal

```bash
bun run build && bun run compile  # single binary at ./sinopebase
./sinopebase --port 8090 --postgresUrl postgres://...
```

## 🧪 Development

```bash
bun install
docker compose up -d          # Test infrastructure

# Test suites
bun test                      # Full suite (1,312 tests)
bun run test:component        # Component tests
bun run test:contract:auth    # Auth contract tests
bun run test:contract:postgrest # PostgREST contract tests
bun run test:contract:storage # Storage contract tests
bun run test:contract:realtime # Realtime contract tests

# Quality gates
bun run typecheck             # tsc --noEmit
bun run lint                  # Biome + ESLint
bun run format                # Biome format
bun run ci                    # Full CI pipeline locally

# Admin UI
cd ui && bun run dev          # Svelte dev server with hot reload
cd ui && bun run build        # Production build → ui/dist/
```

## 📚 Documentation

| Document | Description |
|---|---|
| [Getting Started](docs/getting-started.md) | Installation, configuration, first steps |
| [Auth & SSO](docs/auth.md) | Email, OAuth, SSO, MFA setup |
| [Edge Functions](docs/edge-functions.md) | Bun Worker functions, deployment |
| [AI & Mastra](docs/ai.md) | Agents, tools, MCP, RAG |
| [API Reference](docs/api.md) | REST, Auth, Storage, Realtime APIs |
| [Deployment](docs/deployment.md) | Railway, Docker, bare metal |
| [Development](docs/development.md) | Contributing, architecture, patterns |
| [Design System](design.md) | Cairn — editorial dark design language |

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Write tests first (ATDD — acceptance test-driven development)
4. Implement your feature
5. Run `bun run ci` to verify all quality gates pass
6. Commit with `Co-Authored-By: Claude <noreply@anthropic.com>`
7. Open a PR

See [CONTRIBUTING.md](CONTRIBUTING.md) for full guidelines.

## 📄 License

MIT © Sinopebase

---

<p align="center">
  <sub>Built with ❤️ using <a href="https://bun.sh">Bun</a>, <a href="https://elysiajs.com">Elysia</a>, <a href="https://www.better-auth.com">better-auth</a>, <a href="https://kysely.dev">Kysely</a>, and <a href="https://svelte.dev">Svelte 5</a>.</sub>
</p>
