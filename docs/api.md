# API Reference

Sinopebase exposes a Supabase-compatible API surface. All examples assume `https://your-instance.example.com` as the base URL.

## REST API (PostgREST-compatible)

### Authentication

All requests require an API key via either the `apikey` header or `Authorization: Bearer <token>`.

| Key | Scope |
|---|---|
| `anon` key | Read-only access to public tables |
| `service_role` key | Full admin access, bypasses RLS |
| User JWT | Authenticated user access (RLS applies) |

### Endpoints

#### List rows

```bash
curl 'https://your-instance/rest/v1/todos?select=*&limit=10' \
  -H 'apikey: YOUR_ANON_KEY' \
  -H 'Authorization: Bearer YOUR_ANON_KEY'
```

#### Insert row

```bash
curl 'https://your-instance/rest/v1/todos' \
  -X POST \
  -H 'apikey: YOUR_ANON_KEY' \
  -H 'Authorization: Bearer YOUR_ANON_KEY' \
  -H 'Content-Type: application/json' \
  -H 'Prefer: return=representation' \
  -d '{"title": "Build something great"}'
```

#### Update row

```bash
curl 'https://your-instance/rest/v1/todos?id=eq.1' \
  -X PATCH \
  -H 'apikey: YOUR_ANON_KEY' \
  -H 'Authorization: Bearer YOUR_ANON_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"done": true}'
```

#### Delete row

```bash
curl 'https://your-instance/rest/v1/todos?id=eq.1' \
  -X DELETE \
  -H 'apikey: YOUR_ANON_KEY' \
  -H 'Authorization: Bearer YOUR_ANON_KEY'
```

### Query Parameters

| Parameter | Example | Description |
|---|---|---|
| `select` | `select=id,title` | Columns to return (supports `*`, nested) |
| `limit` | `limit=50` | Max rows to return |
| `offset` | `offset=100` | Pagination offset |
| `order` | `order=created_at.desc` | Sort by column |
| `id=eq.1` | Filter: equals | `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `in`, `is`, `or`, `and` |

## Auth API

### Sign Up

```bash
curl 'https://your-instance/auth/v1/signup' \
  -H 'Content-Type: application/json' \
  -d '{"email": "user@example.com", "password": "password123"}'
```

### Sign In

```bash
curl 'https://your-instance/auth/v1/token?grant_type=password' \
  -H 'Content-Type: application/json' \
  -d '{"email": "user@example.com", "password": "password123"}'
```

### Get User

```bash
curl 'https://your-instance/auth/v1/user' \
  -H 'Authorization: Bearer YOUR_ACCESS_TOKEN'
```

### Sign Out

```bash
curl 'https://your-instance/auth/v1/logout' \
  -X POST \
  -H 'Authorization: Bearer YOUR_ACCESS_TOKEN'
```

## Storage API

### Upload File

```bash
curl 'https://your-instance/storage/v1/object/my-bucket/photo.jpg' \
  -X POST \
  -H 'Authorization: Bearer YOUR_ANON_KEY' \
  -F 'file=@photo.jpg'
```

### Download File

```bash
curl 'https://your-instance/storage/v1/object/my-bucket/photo.jpg' \
  -H 'Authorization: Bearer YOUR_ANON_KEY'
```

### List Files

```bash
curl 'https://your-instance/storage/v1/object/list/my-bucket' \
  -H 'Authorization: Bearer YOUR_ANON_KEY'
```

### Create Bucket

```bash
curl 'https://your-instance/storage/v1/bucket' \
  -X POST \
  -H 'Authorization: Bearer YOUR_SERVICE_ROLE_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"name": "avatars", "public": true}'
```

## Realtime API

Connect via WebSocket to `/realtime/v1/websocket` using the Phoenix Channels protocol.

```js
const ws = new WebSocket('wss://your-instance/realtime/v1/websocket?apikey=YOUR_ANON_KEY')

// Join a topic
ws.send(JSON.stringify({
  topic: 'realtime:public:todos',
  event: 'phx_join',
  payload: {
    config: {
      postgres_changes: [
        { event: '*', schema: 'public', table: 'todos' }
      ]
    }
  },
  ref: '1'
}))
```

## Edge Functions API

```bash
curl 'https://your-instance/api/functions/v1/hello' \
  -X POST \
  -H 'Authorization: Bearer YOUR_ANON_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"name": "World"}'
```

## Admin API

Admin endpoints require the `service_role` key.

### Settings

```bash
# Get settings
curl 'https://your-instance/api/settings' \
  -H 'Authorization: Bearer YOUR_SERVICE_ROLE_KEY'

# Update settings
curl 'https://your-instance/api/settings' \
  -X PATCH \
  -H 'Authorization: Bearer YOUR_SERVICE_ROLE_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"appName": "My App"}'
```

### Backups

```bash
# List backups
curl 'https://your-instance/api/admin/backups' \
  -H 'Authorization: Bearer YOUR_SERVICE_ROLE_KEY'

# Create backup
curl 'https://your-instance/api/admin/backup' \
  -X POST \
  -H 'Authorization: Bearer YOUR_SERVICE_ROLE_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"name": "pre-deploy"}'

# Restore backup
curl 'https://your-instance/api/admin/restore' \
  -X POST \
  -H 'Authorization: Bearer YOUR_SERVICE_ROLE_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"name": "pre-deploy_2026-07-29T00-00-00-000Z"}'
```

### Logs

```bash
curl 'https://your-instance/api/logs?page=1&perPage=50' \
  -H 'Authorization: Bearer YOUR_SERVICE_ROLE_KEY'
```

### Metrics

```bash
curl 'https://your-instance/api/metrics' \
  -H 'Authorization: Bearer YOUR_SERVICE_ROLE_KEY'
```

### Health

```bash
curl 'https://your-instance/api/health'
# → {"code":200,"message":"Sinopebase is running","mode":"development","tls":false,"db":"postgresql","storage":"s3"}

curl 'https://your-instance/api/ready'
# → {"code":200,"status":"ready","db":"connected"}
```
