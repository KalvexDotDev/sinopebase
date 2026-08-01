// ---------------------------------------------------------------------------
// Mastra AI — Integration tests
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Sinopebase } from '~/core/app'
import { MastraPlugin } from '~/plugins/mastra/plugin'
import { requirePostgres, reserveLoopbackPort } from '../../harness'

/** Loose test-response accessor — narrower than `any`. */
interface TestResponse {
  id?: unknown
  choices?: unknown[]
  error?: unknown
  data?: unknown[] | Record<string, unknown>
  [key: string]: unknown
}

describe('Mastra AI Plugin', () => {
  let app: Sinopebase
  let baseUrl: string

  beforeAll(async () => {
    const portReservation = await reserveLoopbackPort()
    app = new Sinopebase({
      port: portReservation.port,
      mode: 'development',
      postgresUrl: requirePostgres(),
    })
    await portReservation.release()

    // MastraPlugin is already registered internally by initializeServer(),
    // but we register it explicitly via app.use() for test isolation.
    const plugin = new MastraPlugin({ requireAuth: false })
    app.use(async (server, _auth) => {
      await plugin.register(server)
    })

    await app.start()

    baseUrl = portReservation.origin
  })

  afterAll(async () => {
    await app.stop()
  })

  // -----------------------------------------------------------------------
  // Chat
  // -----------------------------------------------------------------------

  it('returns chat completion for valid messages', async () => {
    const res = await fetch(`${baseUrl}/api/mastra/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello, how are you?' }],
      }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as TestResponse
    const choices = json.choices as Array<{ message?: { content?: unknown } }>
    expect(json.id).toBeTruthy()
    expect(choices).toBeInstanceOf(Array)
    expect(choices.length).toBeGreaterThan(0)
    expect(choices[0]?.message?.content).toBeTruthy()
  })

  it('rejects chat with empty messages', async () => {
    const res = await fetch(`${baseUrl}/api/mastra/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [] }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects chat with no messages field', async () => {
    const res = await fetch(`${baseUrl}/api/mastra/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('streams chat completion', async () => {
    const res = await fetch(`${baseUrl}/api/mastra/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Tell me a story' }],
      }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/event-stream')

    const text = await res.text()
    expect(text).toContain('data: ')
  })

  // -----------------------------------------------------------------------
  // Embeddings
  // -----------------------------------------------------------------------

  it('returns embeddings for input text', async () => {
    const res = await fetch(`${baseUrl}/api/mastra/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: 'Hello world',
      }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as TestResponse
    const data = json.data as unknown[]
    expect(data).toBeInstanceOf(Array)
    expect(data.length).toBe(1)
    expect((data[0] as Record<string, unknown>).embedding).toBeInstanceOf(Array)
  })

  it('returns embeddings for array input', async () => {
    const res = await fetch(`${baseUrl}/api/mastra/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: ['Hello', 'World', 'Test'],
      }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as TestResponse
    const data = json.data as unknown[]
    expect(data).toBeInstanceOf(Array)
    expect(data.length).toBe(3)
  })

  it('rejects embeddings with no input', async () => {
    const res = await fetch(`${baseUrl}/api/mastra/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })
})
