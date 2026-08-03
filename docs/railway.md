# Deploy and Host Sinopebase on Railway

**Stop building backends. Start shipping products.**

Auth, database, storage, realtime, and AI — one deploy, zero boilerplate. You already know the API.

## What is Sinopebase?

A backend that gives you everything a production app needs in one service. Auth with email and OAuth. PostgreSQL with row-level security. S3-compatible file storage. Realtime channels with presence. Edge functions. AI agents with RAG and streaming. An admin dashboard to manage it all. One import swap from supabase-js. MIT licensed.

## Why Deploy

You don't want to spend another week wiring up sign-up forms, password resets, file uploads, database migrations, and WebSocket channels. You want a backend that works the moment you deploy — with an API you already know, on infrastructure you control.

Deploying on Railway gives you PostgreSQL and S3-compatible storage provisioned automatically. Sinopebase connects to both, runs migrations, and is ready to serve requests in under a minute. You get a public URL, a working auth system, a queryable database, and a realtime WebSocket endpoint — all from one click. You own the data, the keys, and the code. Pay only for what you use, no per-seat fees.

## Dependencies for Sinopebase

### Deployment Dependencies

Sinopebase connects to PostgreSQL and S3-compatible storage. Railway provisions both automatically when you deploy from this template.

| Dependency | How It's Used | Railway Provisioning |
|---|---|---|
| PostgreSQL | Database, auth sessions, migrations, realtime subscriptions | Provisioned automatically as a Railway database service |
| S3-compatible storage | File uploads, downloads, signed URLs | Provisioned automatically as a Railway bucket service |

No other services are required. Auth runs in-process via better-auth. Realtime uses Phoenix Channels built into the Bun server. Edge functions execute in isolated Bun workers. The admin UI is served from the same process.

## About Hosting

Sinopebase is a single Bun service. One click deploys the container, connects your database and bucket, and gives you a public URL. TLS is terminated at Railway's edge — your service speaks plain HTTP internally, HTTPS externally.

Startup takes under a second. System migrations run automatically against your PostgreSQL instance. Auth works immediately — email, password, and OAuth providers are ready to configure. Your database is queryable via the REST API. File uploads just work. Realtime WebSocket channels are live.

The admin UI at `/_/` lets you browse tables, manage users, view logs, and monitor metrics without leaving your browser. API docs are auto-generated at `/api/docs`.

To add OAuth providers, set environment variables like `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in your Railway service settings and redeploy. To add AI features, set `OPENAI_API_KEY` (or swap `OPENAI_BASE_URL` for DeepSeek, Groq, or Ollama).

Scales vertically with bigger Railway instances. For production, enable `SINOPEBASE_PRODUCTION=true` to enforce strong secrets and fail-closed infrastructure checks.

## Common Use Cases

- **Ship your product, not your backend** — auth, database, file storage, realtime, and an admin dashboard in one deploy. Stop rebuilding the same infrastructure for every project.
- **Add a backend to your frontend** — you know the supabase-js API. One import swap and your React, Svelte, or Vue app has a live backend with zero new concepts to learn.
- **Add AI to your stack without adding infrastructure** — agents, RAG, and streaming are built in. Query your database and files from the same endpoint your frontend already calls.
- **Self-host without an ops team** — one process, not a dozen containers. PostgreSQL and S3 are the only external dependencies. If you can run a Docker container, you can run Sinopebase.
