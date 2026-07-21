# AI & Mastra

Sinopebase ships a Mastra-compatible agent system backed by OpenAI (or any
OpenAI-compatible API). Agents can use MCP-style tools to query your database,
read storage, call edge functions, and look up users.

## Quick Start

```bash
curl http://localhost:8090/api/mastra/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello!"}]}'
```

No API key required in development — the mock provider echoes back your input.

```json
{
  "id": "abc123",
  "model": "mock",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "[Mock AI] Echo: Hello!"
    },
    "finishReason": "stop"
  }]
}
```

## Configure OpenAI

```ts
const app = new Sinopebase({
  postgresUrl: '...',
})

// Set API key via environment
// OPENAI_API_KEY=sk-... bun run dev
```

Or programmatically:

```ts
import { MastraPlugin } from 'sinopebase'

const plugin = new MastraPlugin({
  openaiApiKey: 'sk-...',
  defaultModel: 'gpt-4o',
})
await plugin.register(app.server, app.getAuth())
```

## Agents

Agents are AI assistants with access to your Sinopebase resources. The default
agent (`id: 'default'`) has MCP tools for database, storage, and auth.

### Agent Chat

```bash
curl http://localhost:8090/api/mastra/agents/default/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"How many todos are in the database?"}]}'
```

The agent can call tools to answer:

```json
{
  "text": "There are 42 todos in the database, 15 of which are marked complete.",
  "toolCalls": [
    { "name": "db_query", "args": { "table": "todos" }, "result": { "rows": [...], "count": 42 } }
  ],
  "usage": { "promptTokens": 150, "completionTokens": 25, "totalTokens": 175 }
}
```

### Streaming

```bash
curl http://localhost:8090/api/mastra/agents/default/stream \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Tell me a story"}]}'
```

SSE response with `data:` chunks and `[DONE]` termination.

### List Agents

```bash
curl http://localhost:8090/api/mastra/agents
# → { "data": [{ "id": "default", "name": "Sinopebase Assistant" }] }
```

## MCP Tools

MCP (Model Context Protocol) tools give agents controlled access to your
backend. All tools are read-only by default.

| Tool | What it does |
|------|-------------|
| `db_query` | Query any table with optional filters (max 100 rows) |
| `db_schema` | Get column names and types for a table |
| `storage_list` | List files in a storage bucket |
| `storage_read` | Read a file from storage (max 1MB) |
| `auth_user` | Get the currently authenticated user |

Security: `db_query` blocks access to `user`, `session`, `account`, and
`verification` tables. Other tables are readable but never writable through
the tool interface.

## Custom Agents

```ts
import { Agent } from 'sinopebase'

const agent = new Agent({
  id: 'support-bot',
  name: 'Support Bot',
  instructions: 'You are a customer support agent. Be helpful and concise.',
  model: 'gpt-4o',
  tools: [
    {
      id: 'lookup_order',
      name: 'lookup_order',
      description: 'Look up an order by ID',
      parameters: { orderId: { type: 'string' } },
      async execute(input) {
        const rows = await db.select('orders', [{
          column: 'id', operator: 'eq', value: input.orderId
        }])
        return rows[0] || { error: 'Not found' }
      }
    }
  ]
})

const result = await agent.generate([
  { role: 'user', content: 'Where is order #12345?' }
])
```

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/mastra/chat` | OpenAI-compatible chat |
| `POST` | `/api/mastra/chat/stream` | SSE streaming chat |
| `POST` | `/api/mastra/embeddings` | Text embeddings |
| `GET` | `/api/mastra/agents` | List agents |
| `POST` | `/api/mastra/agents/:id/chat` | Agent chat with tool calling |
| `POST` | `/api/mastra/agents/:id/stream` | Agent streaming |

## Comparison: Sinopebase vs Supabase Mastra

| | Supabase Mastra | Sinopebase |
|---|-----------------|------------|
| **Runtime** | Deno / hosted | Bun / self-hosted |
| **Agent SDK** | `@mastra/core` | Compatible Agent class |
| **Tools** | MCP via `@mastra/mcp` | Built-in MCP tools (DB, storage, auth) |
| **Auth** | `@mastra/auth-supabase` | `createMastraAuth()` with better-auth |
| **Streaming** | SSE + AI SDK v5 | SSE via chatStream |
| **Embeddings** | OpenAI / Google | OpenAI-compatible |
| **Open source** | Yes (hosted) | Yes (self-hosted) |
