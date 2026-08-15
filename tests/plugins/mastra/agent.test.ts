// ---------------------------------------------------------------------------
// Mastra AI — Agent registry, execution, MCP tools, and RAG tests
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Sinopebase } from '~/core/app'
import { requirePostgres, reserveLoopbackPort } from '../../harness'

/** Loose test-response accessor — narrower than `any`. */
interface TestResponse {
  data?: unknown
  message?: unknown
  toolCalls?: unknown
  error?: unknown
  [key: string]: unknown
}

describe('Mastra AI Plugin — agents', () => {
  let app: Sinopebase
  let baseUrl: string
  let prevOpenAIKey: string | undefined

  beforeAll(async () => {
    const portReservation = await reserveLoopbackPort()
    // Detach from ambient OPENAI_API_KEY so the mock provider is used
    prevOpenAIKey = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = ''

    app = new Sinopebase({
      port: portReservation.port,
      mode: 'development',
      postgresUrl: requirePostgres(),
      jwtSecret: 'mastra-agent-test-jwt-secret-min-32-chars!',
      serviceRoleKey: 'mastra-agent-test-service-key-min-32-chars!!',
      anonKey: 'mastra-agent-test-anon-key-min-32-chars!!!',
      mastraRequireAuth: false,
    })
    await portReservation.release()

    await app.start()

    baseUrl = portReservation.origin
  })

  afterAll(async () => {
    await app.stop()
    if (prevOpenAIKey) process.env.OPENAI_API_KEY = prevOpenAIKey
  })

  // -----------------------------------------------------------------------
  // Agent registry
  // -----------------------------------------------------------------------

  it('lists the configured agents with their names', async () => {
    const res = await fetch(`${baseUrl}/api/mastra/agents`)
    expect(res.status).toBe(200)
    const json = (await res.json()) as TestResponse
    const data = json.data as Array<{ id?: string; name?: string; model?: string }>
    expect(data).toBeInstanceOf(Array)
    expect(data.length).toBeGreaterThanOrEqual(1)
    const assistant = data.find((a) => a.id === 'default')
    expect(assistant).toBeTruthy()
    expect(assistant?.name).toBe('Sinopebase Assistant')
    // The mock provider is active when OPENAI_API_KEY is unset
    expect(assistant?.model).toBe('mock')
  })

  // -----------------------------------------------------------------------
  // Agent execution
  // -----------------------------------------------------------------------

  it('executes an agent via the chat route with the mock provider', async () => {
    const res = await fetch(`${baseUrl}/api/mastra/agents/default/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello, agent!' }],
      }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as TestResponse
    const message = json.message as { content?: unknown }
    // The mock provider echoes back the last user message
    expect(message.content).toBeTruthy()
    expect(String(message.content)).toContain('[Mock AI] Echo: Hello, agent!')
  })

  it('returns 404 when the agent id does not exist', async () => {
    const res = await fetch(`${baseUrl}/api/mastra/agents/nope/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }),
    })
    expect(res.status).toBe(404)
  })

  it('rejects agent chat with an empty messages array', async () => {
    const res = await fetch(`${baseUrl}/api/mastra/agents/default/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [] }),
    })
    expect(res.status).toBe(400)
  })

  // -----------------------------------------------------------------------
  // MCP tools
  // -----------------------------------------------------------------------
  //
  // ponytail: the plugin exposes no HTTP endpoint that lists MCP tools.
  // Tool registration is verified indirectly by exercising tool execution
  // through the agent chat route.

  it('executes an MCP tool (db_query) through an agent', async () => {
    const res = await fetch(`${baseUrl}/api/mastra/agents/default/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: '[TOOL:db_query]{"table":"todos","limit":1}' }],
      }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as TestResponse
    const toolCalls = json.toolCalls as Array<{ name?: string; result?: unknown }> | undefined
    expect(toolCalls).toBeInstanceOf(Array)
    const call = toolCalls?.find((t) => t.name === 'db_query')
    expect(call).toBeTruthy()
    const result = call?.result as { rows?: unknown[]; count?: number; error?: string }
    expect(Array.isArray(result?.rows)).toBe(true)
    expect(result?.rows?.length).toBeGreaterThanOrEqual(1)
  })

  // -----------------------------------------------------------------------
  // RAG
  // -----------------------------------------------------------------------
  //
  // ponytail: no RAG/vector-search retrieval route is exposed over HTTP.
  // The embeddings endpoint is the retrieval building block; RAG
  // orchestration is not part of the plugin's HTTP surface.

  it('returns embeddings (RAG building block) for input text', async () => {
    const res = await fetch(`${baseUrl}/api/mastra/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'Hello world' }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as TestResponse
    const data = json.data as unknown[]
    expect(data).toBeInstanceOf(Array)
    expect(data.length).toBe(1)
    expect((data[0] as Record<string, unknown>).embedding).toBeInstanceOf(Array)
  })
})
