# Deployment

## Production Configuration

```ts
import { Sinopebase } from 'sinopebase'

const app = new Sinopebase({
  port: 8090,
  postgresUrl: process.env.POSTGRES_URL,
  readReplicaUrl: process.env.READ_REPLICA_URL,  // optional
  jwtSecret: process.env.JWT_SECRET,              // required in prod
  extraOrigins: ['https://myapp.com'],
  oauthProviders: [
    { providerId: 'google', clientId: '...', clientSecret: '...' },
  ],
})

await app.start()
```

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `POSTGRES_URL` | **Yes** (prod) | PostgreSQL connection string |
| `JWT_SECRET` | **Yes** (prod) | Signing key for JWT tokens (≥32 chars) |
| `SINOPEBASE_SERVICE_ROLE_KEY` | **Yes** (prod) | Admin/service-role API key (≥32 chars) |
| `SINOPEBASE_ANON_KEY` | **Yes** (prod) | Anonymous/public API key (≥32 chars) |
| `SINOPEBASE_PRODUCTION` | No | Set to `true` for fail-closed production mode. Or `NODE_ENV=production`. |
| `RUSTFS_ENDPOINT` | **Yes** (prod) | S3-compatible storage URL |
| `RUSTFS_ACCESS_KEY` | **Yes** (prod) | S3 access key |
| `RUSTFS_SECRET_KEY` | **Yes** (prod) | S3 secret key |
| `BETTER_AUTH_URL` | No (prod) | Public-facing base URL for OAuth redirects and CORS (default: `http://localhost:8090`) |
| `OPENAI_API_KEY` | No | Enable real AI responses. Without it, the mock provider echoes back. |
| `OPENAI_BASE_URL` | No | OpenAI-compatible base URL. Swap for DeepSeek, Groq, Ollama, etc. (default: `https://api.openai.com/v1`) |
| `PORT` | No | Server port (default: `8090`, or `$PORT` on Railway) |
| `HOST` | No | Bind address (default: `0.0.0.0`) |

See `.env.example` for a complete template with placeholder values. Copy with `cp .env.example .env`.

## TLS / HTTPS

Sinopebase supports two TLS modes:

### Option A: Reverse proxy (recommended for production)

Run behind nginx, Caddy, or Railway's edge proxy:

```nginx
# nginx example
server {
    listen 443 ssl;
    server_name api.example.com;

    location / {
        proxy_pass http://127.0.0.1:8090;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
    }

    # WebSocket upgrade for realtime
    location /realtime/v1/websocket {
        proxy_pass http://127.0.0.1:8090;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### Caddy (auto TLS)

```
api.example.com {
    reverse_proxy 127.0.0.1:8090
}
```

### Option B: Bun-native TLS

Sinopebase can serve HTTPS directly using Bun's built-in TLS:

```bash
bun run cmd/serve.ts --tls-cert cert.pem --tls-key key.pem
```

For development: `bash scripts/gen-dev-cert.sh` generates a self-signed certificate.

For production with auto-renewal, prefer Option A (reverse proxy) — it's the battle-tested pattern.

## Docker (Self-Contained)

```dockerfile
FROM oven/bun:1.3

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

EXPOSE 8090
CMD ["bun", "run", "dist/index.js"]
```

```bash
docker build -t sinopebase .
docker run -p 8090:8090 \
  -e POSTGRES_URL=postgresql://host:5432/db \
  -e JWT_SECRET=your-secret \
  sinopebase
```

## Docker Compose (Full Stack)

Use the prebuilt image — no local build needed. Pins to the latest tagged release.

```bash
# Copy and fill in secrets
cp .env.example .env
# Edit .env with: JWT_SECRET, SINOPEBASE_SERVICE_ROLE_KEY, SINOPEBASE_ANON_KEY,
#                 DB_PASSWORD, S3_ACCESS_KEY, S3_SECRET_KEY

docker compose -f docker-compose.prod.yml up -d
```

`docker-compose.prod.yml` pulls `ghcr.io/kalvexdotdev/sinopebase:latest` and starts PostgreSQL, RustFS, and PgBouncer alongside it. For production, pin a specific version:

```bash
SINOPEBASE_VERSION=v0.6.2 docker compose -f docker-compose.prod.yml up -d
```

The compose file uses `${VAR:?message}` syntax — Docker will refuse to start if required secrets are missing.

### Reference (inline compose excerpt)

```yaml
# docker-compose.prod.yml
services:
  sinopebase:
    image: ghcr.io/kalvexdotdev/sinopebase:latest
    ports: ['8090:8090']
    environment:
      POSTGRES_URL: postgresql://sinopebase:${DB_PASSWORD}@postgres:5432/sinopebase
      JWT_SECRET: ${JWT_SECRET:?JWT_SECRET must be set}
      RUSTFS_ENDPOINT: http://rustfs:9000
      SINOPEBASE_PRODUCTION: 'true'
    depends_on: [postgres, rustfs]
    read_only: true
    restart: unless-stopped

  postgres:
    image: postgres:18.4-alpine
    environment:
      POSTGRES_USER: sinopebase
      POSTGRES_PASSWORD: ${DB_PASSWORD:?DB_PASSWORD must be set}
      POSTGRES_DB: sinopebase
    volumes: ['pgdata:/var/lib/postgresql']

  rustfs:
    image: rustfs/rustfs:latest
    environment:
      RUSTFS_ROOT_USER: ${S3_USER}
      RUSTFS_ROOT_PASSWORD: ${S3_PASSWORD}
    volumes: ['storagedata:/data']

  pgbouncer:
    image: edoburu/pgbouncer:latest
    environment:
      DB_HOST: postgres
      DB_USER: sinopebase
      DB_PASSWORD: ${DB_PASSWORD}
      DB_NAME: sinopebase
    ports: ['6432:5432']

volumes:
  pgdata:
  storagedata:
```

## Read Replicas

Add a read replica for horizontal scaling:

```ts
const app = new Sinopebase({
  postgresUrl: process.env.POSTGRES_URL,          // primary
  readReplicaUrl: process.env.READ_REPLICA_URL,   // replica
})
```

SELECT and COUNT queries route to the replica. Writes (INSERT, UPDATE, DELETE)
always go to the primary.

## Backups

```bash
# Create a backup (requires auth)
curl -X POST http://localhost:8090/api/backups \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"daily-backup"}'

# Restore a backup
curl -X POST http://localhost:8090/api/backups/daily-backup/restore \
  -H "Authorization: Bearer <token>"

# List backups
curl http://localhost:8090/api/backups
```

Backups are stored in the configured S3/RustFS bucket. Uses `pg_dump` custom
format for consistent, parallel-safe snapshots.

## Metrics

```bash
# JSON
curl http://localhost:8090/api/metrics

# Prometheus scrape target
curl http://localhost:8090/metrics
```

Available metrics: uptime, request count by status/method, latency
(p50/p95/p99), memory usage.

## Log Retention

Configure retention in the LogRetentionPlugin:

```ts
import { LogRetentionPlugin } from 'sinopebase'

const logs = new LogRetentionPlugin({ retentionDays: 90 })
await logs.register(app.server, app.getDatabase())
```

Logs older than the retention window are deleted every 6 hours.
