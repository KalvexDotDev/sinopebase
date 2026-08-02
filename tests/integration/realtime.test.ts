/**
 * Realtime ATDD Tests
 *
 * Ported from supabase-js test/integration.test.ts (Realtime block).
 * These drive implementation of the Phoenix Channels /realtime/v1 WebSocket layer.
 *
 * Comprehensive tests covering:
 * - Broadcast send/receive (basic flow)
 * - Unauthorized phx_join rejection
 * - Broadcast payload size limit (DoS protection)
 * - Postgres changes delivery via REST mutations
 * - Subscriber visibility isolation
 * - Unjoined channel broadcast rejection
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Sinopebase } from '../../src/core/app'
import { createClient, type SinopebaseClient } from '../../src/sdk/client'
import type { RealtimeChannel } from '../../src/sdk/realtime'
import { requirePostgres, reserveLoopbackPort } from '../harness'
import { pollUntil } from './setup'

let client: SinopebaseClient
let server: Sinopebase
let origin: string
let anonKey: string
let serviceKey: string

beforeAll(async () => {
  const portReservation = await reserveLoopbackPort()
  anonKey = 'realtimetest-anon-key-min-32-chars!!!!'
  serviceKey = 'realtimetest-service-key-min-32-chars!!!'
  server = new Sinopebase({
    postgresUrl: requirePostgres(),
    port: portReservation.port,
    jwtSecret: 'realtimetest-jwt-secret-min-32-chars!!',
    serviceRoleKey: serviceKey,
    anonKey: anonKey,
  })
  await portReservation.release()
  await server.start()
  origin = portReservation.origin
  client = createClient(origin, anonKey)
})

afterAll(async () => {
  await server.stop()
})

// ── Helper: raw WebSocket for protocol-level testing ───────────────────────

/**
 * Open a raw WebSocket to /realtime/v1 and return it along with a buffer of
 * received Phoenix-v2 messages.
 */
async function rawRealtimeSocket(
  baseUrl: string,
  apiKey: string,
): Promise<{ ws: WebSocket; messages: unknown[]; close: () => void }> {
  const messages: unknown[] = []
  const ws = new WebSocket(
    `${baseUrl.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${apiKey}&vsn=2.0.0`,
  )
  ws.onmessage = (event) => {
    try {
      messages.push(JSON.parse(event.data as string))
    } catch {
      /* ignore malformed frames */
    }
  }
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = () => reject(new Error('WebSocket connection failed'))
  })
  return {
    ws,
    messages,
    close: () => {
      ws.close()
    },
  }
}

/**
 * Wait for a raw WebSocket message matching the predicate.
 */
async function waitForMessage<T>(
  messages: unknown[],
  predicate: (msg: unknown) => boolean,
  timeoutMs = 5000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const msg = messages.find(predicate)
    if (msg) return msg as T
    await Bun.sleep(20)
  }
  throw new Error('Timed out waiting for WebSocket message')
}

type PhoenixV2Message = [
  joinRef: string | null,
  ref: string | null,
  topic: string,
  event: string,
  payload: Record<string, unknown>,
]

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Realtime', () => {
  describe('broadcast', () => {
    it('connect + subscribe + broadcast + receive', async () => {
      const messages: unknown[] = []

      const channel: RealtimeChannel = client.realtime
        .channel('test-room')
        .on('broadcast', { event: 'test-event' }, (payload: unknown) => {
          messages.push(payload)
        })

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Subscribe timeout')), 5000)

        channel.subscribe((status: string) => {
          if (status === 'SUBSCRIBED') {
            clearTimeout(timeout)
            resolve()
          }
        })
      })

      // Send a broadcast
      const testPayload = { message: 'hello from sinopebase', timestamp: Date.now() }
      channel.send({
        type: 'broadcast',
        event: 'test-event',
        payload: testPayload,
      })

      // Poll until we receive the message (mirrors supabase-js pattern)
      await pollUntil(() => messages.length > 0)

      expect(messages.length).toBeGreaterThan(0)
      // SDK client unwraps the Phoenix envelope: the callback receives the
      // broadcast envelope { type, event, payload: <user-data> } directly.
      const received = messages[0] as Record<string, unknown>
      expect(received.payload).toEqual(testPayload)

      channel.unsubscribe()
    })
  })

  describe('postgres changes', () => {
    it('delivers postgres_changes via REST mutations', async () => {
      const { ws, messages, close } = await rawRealtimeSocket(origin, anonKey)
      const topic = 'realtime:pg-test'
      const testId = `rt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

      try {
        // Subscribe to all changes on the 'todos' table
        ws.send(
          JSON.stringify([
            '1',
            '1',
            topic,
            'phx_join',
            {
              config: {
                broadcast: { ack: false, self: false },
                presence: { enabled: false },
                postgres_changes: [
                  { event: 'INSERT', schema: 'public', table: 'todos', filter: null },
                  { event: 'UPDATE', schema: 'public', table: 'todos', filter: null },
                  { event: 'DELETE', schema: 'public', table: 'todos', filter: null },
                ],
              },
            },
          ]),
        )

        // Wait for phx_reply confirming the subscription
        const reply = await waitForMessage<PhoenixV2Message>(messages, (m) => {
          const msg = m as PhoenixV2Message
          return Array.isArray(msg) && msg[2] === topic && msg[3] === 'phx_reply'
        })
        expect(reply[4]).toMatchObject({
          status: 'ok',
          response: {
            postgres_changes: expect.arrayContaining([
              expect.objectContaining({ event: 'INSERT' }),
              expect.objectContaining({ event: 'UPDATE' }),
              expect.objectContaining({ event: 'DELETE' }),
            ]),
          },
        })

        // Wait a tick for the server-side topic binding, then INSERT
        await Bun.sleep(50)
        const insertResp = await fetch(`${origin}/rest/v1/todos`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ id: testId, task: 'realtime test' }),
        })
        expect(insertResp.status).toBe(201)

        const insertMsg = await waitForMessage<PhoenixV2Message>(messages, (m) => {
          const msg = m as PhoenixV2Message
          return Array.isArray(msg) && msg[2] === topic && msg[3] === 'postgres_changes'
        })
        expect(insertMsg[4]).toMatchObject({
          ids: expect.any(Array),
          data: {
            type: 'INSERT',
            schema: 'public',
            table: 'todos',
            record: expect.objectContaining({ id: testId }),
            old_record: {},
          },
        })
      } finally {
        close()
      }
    })
  })

  describe('security', () => {
    it('rejects phx_join with an invalid API key', async () => {
      const { ws, messages, close } = await rawRealtimeSocket(origin, 'definitely-not-a-valid-key')

      try {
        ws.send(
          JSON.stringify([
            '1',
            '1',
            'realtime:evil',
            'phx_join',
            {
              config: {
                broadcast: { ack: false, self: false },
                presence: { enabled: false },
                postgres_changes: [],
              },
            },
          ]),
        )

        const reply = await waitForMessage<PhoenixV2Message>(messages, (m) => {
          const msg = m as PhoenixV2Message
          return Array.isArray(msg) && msg[2] === 'realtime:evil' && msg[3] === 'phx_reply'
        })
        expect(reply[4]).toMatchObject({
          status: 'error',
          response: { reason: 'unauthorized' },
        })
      } finally {
        close()
      }
    })

    it('rejects broadcast to an unjoined channel', async () => {
      const { ws, messages, close } = await rawRealtimeSocket(origin, anonKey)
      const topic = 'realtime:no-join-test'

      try {
        // Send broadcast WITHOUT joining first
        ws.send(
          JSON.stringify([
            '1',
            '1',
            topic,
            'broadcast',
            {
              type: 'broadcast',
              event: 'test',
              payload: { msg: 'hello' },
            },
          ]),
        )

        const reply = await waitForMessage<PhoenixV2Message>(messages, (m) => {
          const msg = m as PhoenixV2Message
          return Array.isArray(msg) && msg[1] === '1' && msg[2] === topic && msg[3] === 'phx_reply'
        })
        expect(reply[4]).toMatchObject({
          status: 'error',
          response: { reason: 'you must join the channel before broadcasting' },
        })
      } finally {
        close()
      }
    })

    it('rejects broadcast payloads exceeding the size limit', async () => {
      const { ws, messages, close } = await rawRealtimeSocket(origin, anonKey)
      const topic = 'realtime:size-test'

      try {
        // Join the channel first
        ws.send(
          JSON.stringify([
            '1',
            '1',
            topic,
            'phx_join',
            {
              config: {
                broadcast: { ack: false, self: false },
                presence: { enabled: false },
                postgres_changes: [],
              },
            },
          ]),
        )

        const joinReply = await waitForMessage<PhoenixV2Message>(messages, (m) => {
          const msg = m as PhoenixV2Message
          return Array.isArray(msg) && msg[2] === topic && msg[3] === 'phx_reply'
        })
        expect(joinReply[4]).toMatchObject({ status: 'ok' })

        // Send a broadcast payload exceeding the default 100 KB limit
        const oversized = {
          type: 'broadcast',
          event: 'big',
          payload: { data: 'x'.repeat(120_000) },
        }
        ws.send(JSON.stringify(['1', '2', topic, 'broadcast', oversized]))

        const errorReply = await waitForMessage<PhoenixV2Message>(messages, (m) => {
          const msg = m as PhoenixV2Message
          return Array.isArray(msg) && msg[1] === '2' && msg[2] === topic && msg[3] === 'phx_reply'
        })
        expect(errorReply[4]).toMatchObject({
          status: 'error',
          response: { reason: 'broadcast payload exceeds size limit' },
        })
      } finally {
        close()
      }
    })
  })
})
