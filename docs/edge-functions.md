# Edge Functions

Sinopebase edge functions are TypeScript files that run in isolated Bun Worker
threads. Drop-in compatible with Supabase Edge Functions, minus the Deno
dependency.

## Quick Start

Create `functions/hello.ts`:

```ts
export const config = {
  auth: false,       // require Bearer token? (default: false)
  timeout: 10000,    // max execution ms (default: 5000)
}

export default async function handler(req: Request, ctx: FunctionContext) {
  const { name } = await req.json()
  return { message: `Hello, ${name || 'World'}!` }
}
```

Call it:

```ts
const { data } = await sb.functions.invoke('hello', {
  body: { name: 'Sinopebase' }
})
// → { message: "Hello, Sinopebase!" }
```

Or via HTTP:

```bash
curl http://localhost:8090/functions/v1/hello \
  -H "Content-Type: application/json" \
  -d '{"name": "World"}'
```

## Function Context

```ts
interface FunctionContext {
  requestId: string          // unique per invocation
  functionName: string       // filename without extension
  auth: {                    // null if config.auth is false
    userId: string
    email: string
    role: string
  } | null
  env: Record<string, string>  // frozen snapshot of process.env
  log: (level, message, extra?) => void
}
```

## Per-Function Config

Each function can export a named `config` object:

```ts
export const config = {
  auth: true,              // require Bearer token
  timeout: 30000,          // 30s timeout
  rateLimit: {
    requests: 50,          // max requests
    window: '5m',          // per 5 minutes
  },
}

export default async function handler(req, ctx) {
  // ctx.auth is guaranteed non-null when config.auth is true
  console.log('Called by:', ctx.auth.email)
  return { ok: true }
}
```

## Worker Isolation (v0.3)

Functions run in dedicated Bun Worker threads:

- **Crash isolation**: a hung function kills only its Worker, not the server
- **Timeout Guillotine**: `worker.terminate()` fires after `config.timeout` ms
- **No env inheritance**: the Worker runs with an empty `process.env`
- **Response passthrough**: returning `new Response(...)` forwards headers + status

A function that loops forever:
```ts
export const config = { timeout: 1000 }
export default async () => { while (true) {} }
// → 504 Gateway Timeout after 1000ms
```

## Management API

Functions can be managed via the REST API (requires auth):

```bash
# List functions
curl http://localhost:8090/api/functions/v1 -H "Authorization: Bearer <token>"

# Get source
curl http://localhost:8090/api/functions/v1/hello/source

# Create
curl -X POST http://localhost:8090/api/functions/v1 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"name":"myfn","source":"export default async () => ({ok:true})"}'

# Delete
curl -X DELETE http://localhost:8090/api/functions/v1/myfn
```

## Paths

| Path | Purpose |
|------|---------|
| `/api/functions/v1/:name` | Execute (Sinopebase path) |
| `/functions/v1/:name` | Execute (Supabase-compatible alias) |
| `/api/functions/v1` | List functions (auth required) |
| `/api/functions/v1/:name/source` | Get source (auth required) |
