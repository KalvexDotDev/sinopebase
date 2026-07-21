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
| `POSTGRES_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | **Yes** | Signing key for JWT tokens (≥32 chars) |
| `READ_REPLICA_URL` | No | Read replica for SELECT queries |
| `RUSTFS_ENDPOINT` | No | S3-compatible storage URL |
| `RUSTFS_ACCESS_KEY` | No | S3 access key |
| `RUSTFS_SECRET_KEY` | No | S3 secret key |
| `OPENAI_API_KEY` | No | For AI/Mastra features |
| `SINOPEBASE_PORT` | No | Server port (default 8090) |

## TLS / HTTPS

Sinopebase itself serves plain HTTP. Run it behind a reverse proxy for TLS:

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

```yaml
# docker-compose.prod.yml
services:
  sinopebase:
    build: .
    ports: ['8090:8090']
    environment:
      POSTGRES_URL: postgresql://postgres:5432/sinopebase
      JWT_SECRET: ${JWT_SECRET}
      RUSTFS_ENDPOINT: http://rustfs:9000
    depends_on: [postgres, rustfs]

  postgres:
    image: postgres:18.4-alpine
    environment:
      POSTGRES_USER: sinopebase
      POSTGRES_PASSWORD: ${DB_PASSWORD}
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
