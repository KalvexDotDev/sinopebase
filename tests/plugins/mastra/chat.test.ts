// ---------------------------------------------------------------------------
// Mastra AI — Integration tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { Sinopebase } from '~/core/app'
import { MastraPlugin } from '~/plugins/mastra/plugin'
import { reserveLoopbackPort, requirePostgres } from '../../harness'

describe('Mastra AI Plugin', () => {
  let app: Sinopebase
  let baseUrl: string

  beforeAll(async () => {
    const portReservation = await reserveLoopbackPort()
    app = new Sinopebase({
      port: portReservation.port,
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
    const res = await fetch(baseUrl + '/api/mastra/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'Hello, how are you?' },
        ],
      }),
    })
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.id).toBeTruthy()
    expect(json.choices).toBeInstanceOf(Array)
    expect(json.choices.length).toBeGreaterThan(0)
    expect(json.choices[0].message.content).toBeTruthy()
  })

  it('rejects chat with empty messages', async () => {
    const res = await fetch(baseUrl + '/api/mastra/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [] }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects chat with no messages field', async () => {
    const res = await fetch(baseUrl + '/api/mastra/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('streams chat completion', async () => {
    const res = await fetch(baseUrl + '/api/mastra/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'Tell me a story' },
        ],
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
    const res = await fetch(baseUrl + '/api/mastra/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: 'Hello world',
      }),
    })
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.data).toBeInstanceOf(Array)
    expect(json.data.length).toBe(1)
    expect(json.data[0].embedding).toBeInstanceOf(Array)
  })

  it('returns embeddings for array input', async () => {
    const res = await fetch(baseUrl + '/api/mastra/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: ['Hello', 'World', 'Test'],
      }),
    })
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.data).toBeInstanceOf(Array)
    expect(json.data.length).toBe(3)
  })

  it('rejects embeddings with no input', async () => {
    const res = await fetch(baseUrl + '/api/mastra/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })
})
