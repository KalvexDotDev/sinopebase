import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import WebSocket from 'ws'
import { MemoryDatabase } from '../core/db-memory'
import { MemoryDatabaseAdapter } from '../core/db-memory-adapter'
import { mountPostgrestRoutes } from './postgrest'
import {
  createRealtimeHub,
  createRealtimeWebSocketHandler,
} from './realtime'

type PhoenixV2Message = [
  joinRef: string | null,
  ref: string | null,
  topic: string,
  event: string,
  payload: Record<string, unknown>,
]

describe('Realtime postgres_changes compatibility', () => {
  let app: Elysia
  let baseUrl: string
  let socket: WebSocket
  const messages: PhoenixV2Message[] = []

  beforeAll(async () => {
    const memDb = new MemoryDatabase()
    memDb.createTable('items')
    const db = new MemoryDatabaseAdapter(memDb)
    const realtime = createRealtimeHub()

    app = new Elysia()
      .ws('/realtime/v1/websocket', createRealtimeWebSocketHandler(realtime))
    mountPostgrestRoutes(app, db, undefined, realtime)
    app.listen(0)

    baseUrl = `http://127.0.0.1:${app.server!.port}`
    socket = new WebSocket(
      baseUrl.replace('http:', 'ws:') + '/realtime/v1/websocket?apikey=test-anon-key&vsn=2.0.0',
    )
    socket.on('message', (raw) => messages.push(JSON.parse(raw.toString())))
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })
  })

  afterAll(() => {
    socket.close()
    app.stop()
  })

  it('delivers matching INSERT, UPDATE, and DELETE REST mutations', async () => {
    const topic = 'realtime:tenant-a-items'
    const filters = ['INSERT', 'UPDATE', 'DELETE'].map((event) => ({
      event,
      schema: 'public',
      table: 'items',
      filter: 'tenant_id=eq.tenant-a',
    }))

    socket.send(JSON.stringify(['1', '1', topic, 'phx_join', {
      config: {
        broadcast: { ack: false, self: false },
        presence: { enabled: false },
        postgres_changes: filters,
      },
    }]))

    const reply = await waitForMessage(messages, (message) =>
      message[2] === topic && message[3] === 'phx_reply'
    )
    expect(reply[4]).toMatchObject({
      status: 'ok',
      response: {
        postgres_changes: filters.map((filter) => ({ ...filter, id: expect.any(Number) })),
      },
    })

    await mutate(baseUrl, 'POST', '/rest/v1/items', {
      id: 'ignored',
      tenant_id: 'tenant-b',
      label: 'not delivered',
    })
    await mutate(baseUrl, 'POST', '/rest/v1/items', {
      id: 'item-a',
      tenant_id: 'tenant-a',
      label: 'created',
    })
    await mutate(baseUrl, 'PATCH', '/rest/v1/items?id=eq.item-a', {
      label: 'updated',
    })
    await mutate(baseUrl, 'DELETE', '/rest/v1/items?id=eq.item-a')

    const changes = await waitForChanges(messages, topic, 3)
    expect(changes.map((message) => message[4]['data'])).toMatchObject([
      {
        type: 'INSERT',
        schema: 'public',
        table: 'items',
        record: { id: 'item-a', tenant_id: 'tenant-a', label: 'created' },
        old_record: {},
      },
      {
        type: 'UPDATE',
        schema: 'public',
        table: 'items',
        record: { id: 'item-a', tenant_id: 'tenant-a', label: 'updated' },
        old_record: {},
      },
      {
        type: 'DELETE',
        schema: 'public',
        table: 'items',
        record: {},
        old_record: { id: 'item-a', tenant_id: 'tenant-a', label: 'updated' },
      },
    ])
  })
})

describe('Realtime subscriber visibility', () => {
  it('does not deliver a matching table event when subscriber RLS rejects the row', async () => {
    const hub = createRealtimeHub<string>({
      authorize: async (token) => token,
      canRead: async (tenant, change) => change.new['tenant_id'] === tenant,
    })
    const tenantA = new TestSocket('tenant-a')
    const tenantB = new TestSocket('tenant-b')
    const join = (tenant: TestSocket) => hub.handleMessage(tenant, [
      '1',
      '1',
      'realtime:items',
      'phx_join',
      {
        config: {
          postgres_changes: [{ event: 'INSERT', schema: 'public', table: 'items' }],
        },
      },
    ])

    await Promise.all([join(tenantA), join(tenantB)])
    tenantA.sent.length = 0
    tenantB.sent.length = 0
    await hub.publishPostgresChange({
      schema: 'public',
      table: 'items',
      event: 'INSERT',
      new: { id: 'item-a', tenant_id: 'tenant-a' },
      old: {},
    })

    expect(tenantA.sent).toHaveLength(1)
    expect(tenantB.sent).toHaveLength(0)
  })

  it('projects columns according to subscription filter', async () => {
    const hub = createRealtimeHub()
    const client = new TestSocket('anon')

    await hub.handleMessage(client, [
      '1',
      '1',
      'realtime:items',
      'phx_join',
      {
        config: {
          postgres_changes: [
            {
              event: 'INSERT',
              schema: 'public',
              table: 'items',
              columns: ['id', 'label'],
            },
          ],
        },
      },
    ])
    client.sent.length = 0

    await hub.publishPostgresChange({
      schema: 'public',
      table: 'items',
      event: 'INSERT',
      new: { id: 'proj-1', label: 'visible', secret: 'hidden' },
      old: {},
    })

    const payload = client.lastPostgresChangePayload()
    expect(payload).not.toBeNull()
    const data = payload!['data'] as Record<string, unknown>
    expect(data['record']).toEqual({ id: 'proj-1', label: 'visible' })
    // The 'secret' column must NOT be present in the projected record
    expect((data['record'] as Record<string, unknown>)['secret']).toBeUndefined()
    // old_record should be filtered too
    expect(data['old_record']).toEqual({})
  })

  it('projects columns in UPDATE old_record and DELETE old_record', async () => {
    const hub = createRealtimeHub()
    const client = new TestSocket('anon')

    await hub.handleMessage(client, [
      '1',
      '1',
      'realtime:items',
      'phx_join',
      {
        config: {
          postgres_changes: [
            { event: 'UPDATE', schema: 'public', table: 'items', columns: ['id', 'status'] },
            { event: 'DELETE', schema: 'public', table: 'items', columns: ['id', 'status'] },
          ],
        },
      },
    ])
    client.sent.length = 0

    // UPDATE: old and new should both be projected
    await hub.publishPostgresChange({
      schema: 'public',
      table: 'items',
      event: 'UPDATE',
      new: { id: 'upd-1', status: 'done', internal_note: 'hidden' },
      old: { id: 'upd-1', status: 'pending', internal_note: 'hidden' },
    })

    const updatePayload = client.lastPostgresChangePayload()
    expect(updatePayload).not.toBeNull()
    const updateData = updatePayload!['data'] as Record<string, unknown>
    expect(updateData['record']).toEqual({ id: 'upd-1', status: 'done' })
    expect(updateData['old_record']).toEqual({ id: 'upd-1', status: 'pending' })

    client.sent.length = 0

    // DELETE: old should be projected, new should be empty
    await hub.publishPostgresChange({
      schema: 'public',
      table: 'items',
      event: 'DELETE',
      new: {},
      old: { id: 'del-1', status: 'archived', internal_note: 'hidden' },
    })

    const deletePayload = client.lastPostgresChangePayload()
    expect(deletePayload).not.toBeNull()
    const deleteData = deletePayload!['data'] as Record<string, unknown>
    expect(deleteData['record']).toEqual({})
    expect(deleteData['old_record']).toEqual({ id: 'del-1', status: 'archived' })
    expect((deleteData['old_record'] as Record<string, unknown>)['internal_note']).toBeUndefined()
  })
})

describe('Realtime auth enforcement', () => {
  it('rejects phx_join when authorize callback returns undefined', async () => {
    const hub = createRealtimeHub<string>({
      authorize: async () => undefined,
    })
    const client = new TestSocket('invalid-key')
    const msg: PhoenixV2Message = [
      '1', '1', 'realtime:secret', 'phx_join',
      { config: { postgres_changes: [] } },
    ]

    await hub.handleMessage(client, msg)

    expect(client.sent).toHaveLength(1)
    const raw = client.sent[0]
    expect(typeof raw).toBe('string')
    const parsed = JSON.parse(raw as string)
    // The hub replies in v2 format: [joinRef, ref, topic, event, payload]
    // parsed[3] = 'phx_reply', parsed[4] = { status, response }
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed[3]).toBe('phx_reply')
    expect(parsed[4]).toMatchObject({
      status: 'error',
      response: { reason: 'unauthorized' },
    })
  })

  it('rejects broadcast from unauthenticated client when authorize is configured', async () => {
    const hub = createRealtimeHub<string>({
      authorize: async () => undefined,
    })
    const client = new TestSocket('no-auth')

    // phx_join — will be rejected by authorize, but the entry still exists
    // with context=undefined and no topics.
    await hub.handleMessage(client, [
      '1', '1', 'realtime:broadcast-test', 'phx_join',
      { config: { postgres_changes: [] } },
    ])
    // Clear the phx_reply so we can find the broadcast-reply
    client.sent.length = 0

    // Try to broadcast (should fail — no topic joined, no auth context)
    await hub.handleMessage(client, [
      '1', '2', 'realtime:broadcast-test', 'broadcast',
      { type: 'broadcast', event: 'test', payload: { msg: 'nope' } },
    ])

    expect(client.sent.length).toBeGreaterThan(0)
    const lastRaw = client.sent[client.sent.length - 1]
    const parsed = JSON.parse(typeof lastRaw === 'string' ? lastRaw : '[]')
    // The hub replies in v2 format: [joinRef, ref, topic, event, payload]
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed[3]).toBe('phx_reply')
    expect(parsed[4]?.status).toBe('error')
  })
})

class TestSocket {
  readonly sent: unknown[] = []
  readonly data: { query: { apikey: string } }

  constructor(apiKey: string) {
    this.data = { query: { apikey: apiKey } }
  }

  send(data: unknown): void {
    this.sent.push(data)
  }

  subscribe(_topic: string): void {}
  unsubscribe(_topic: string): void {}
  publish(_topic: string, _data: unknown): void {}

  /** Extract the last Phoenix-v2 postgres_changes payload, or fail. */
  lastPostgresChangePayload(): Record<string, unknown> | null {
    for (let i = this.sent.length - 1; i >= 0; i--) {
      const raw = this.sent[i]
      if (typeof raw !== 'string') continue
      try {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed[3] === 'postgres_changes') {
          return parsed[4] as Record<string, unknown>
        }
      } catch { /* skip */ }
    }
    return null
  }
}

async function mutate(
  baseUrl: string,
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(baseUrl + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) {
    throw new Error(`${method} ${path} failed (${response.status}): ${await response.text()}`)
  }
}

async function waitForMessage(
  messages: PhoenixV2Message[],
  predicate: (message: PhoenixV2Message) => boolean,
): Promise<PhoenixV2Message> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    const message = messages.find(predicate)
    if (message) return message
    await Bun.sleep(10)
  }
  throw new Error('Timed out waiting for Realtime message')
}

async function waitForChanges(
  messages: PhoenixV2Message[],
  topic: string,
  count: number,
): Promise<PhoenixV2Message[]> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    const changes = messages.filter((message) =>
      message[2] === topic && message[3] === 'postgres_changes'
    )
    if (changes.length >= count) return changes
    await Bun.sleep(10)
  }
  throw new Error(`Timed out waiting for ${count} Realtime changes`)
}
