/**
 * realtime setAuth() — full-server contract tests.
 *
 * setAuth() must:
 * - drop the live socket so the current credentials stop working immediately
 * - not reconnect with the old credentials afterwards
 * - apply the new token to the next connection
 * - restore the API key when called with null
 *
 * Wire contract exercised here (Phoenix v2):
 * - The WebSocket URL carries `apikey=<token>`; the server validates the
 *   token at phx_join time.
 * - An unauthorized phx_join is answered with a phx_reply error and the
 *   channel is not bound, so subsequent track events are rejected.
 *
 * The socket URLs are captured through a spy so the test can assert exactly
 * which credentials a (re)connection uses. All other assertions run against
 * the real server over the wire.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Sinopebase } from '../../src/core/app'
import { createClient, type SinopebaseClient } from '../../src/sdk/client'
import { requirePostgres, reserveLoopbackPort } from '../harness'
import { pollUntil } from './setup'

const anonKey = 'setauth-test-anon-key-min-32-chars!!!'
const invalidToken = '<invalid-token>'

let server: Sinopebase
let origin: string

// The real WebSocket implementation, saved before the URL spy is installed.
const RealWebSocket = globalThis.WebSocket
const createdUrls: string[] = []

beforeAll(async () => {
  const portReservation = await reserveLoopbackPort()
  server = new Sinopebase({
    postgresUrl: requirePostgres(),
    port: portReservation.port,
    jwtSecret: 'setauth-test-jwt-secret-min-32-chars!',
    serviceRoleKey: 'setauth-test-service-key-min-32-chars!!',
    anonKey: anonKey,
  })
  await portReservation.release()
  await server.start()
  origin = portReservation.origin

  // Capture the URL of every WebSocket the SDK opens so the test can assert
  // which credentials a (re)connection carries.
  globalThis.WebSocket = class extends RealWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols)
      createdUrls.push(String(url))
    }
  } as unknown as typeof WebSocket
})

afterAll(async () => {
  globalThis.WebSocket = RealWebSocket
  await server.stop()
})

// ── Helpers (raw WebSocket for protocol-level observation) ────────────────
// ponytail: rawRealtimeSocket / waitForMessage / isPhoenix are duplicated
// across the realtime test files — extract them into tests/harness/realtime.ts.

async function rawRealtimeSocket(
  baseUrl: string,
  apiKey: string,
  wsClass: typeof WebSocket = globalThis.WebSocket,
): Promise<{ ws: WebSocket; messages: unknown[]; close: () => void }> {
  const messages: unknown[] = []
  const ws = new wsClass(
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

async function waitForMessage<T>(
  messages: unknown[],
  predicate: (msg: unknown, index: number) => boolean,
  timeoutMs = 5000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const msg = messages.find((m, i) => predicate(m, i))
    if (msg) return msg as T
    await Bun.sleep(20)
  }
  throw new Error('Timed out waiting for WebSocket message')
}

type PhoenixV2 = [string | null, string | null, string, string, Record<string, unknown>]

function isPhoenix(m: unknown, topic: string, event: string, ref?: string): boolean {
  const msg = m as PhoenixV2
  return (
    Array.isArray(msg) &&
    msg[2] === topic &&
    msg[3] === event &&
    (ref === undefined || msg[1] === ref)
  )
}

function uniqueTopic(prefix: string): string {
  return `realtime:setauth-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function joinPayload(): Record<string, unknown> {
  return {
    config: {
      broadcast: { ack: false, self: false },
      presence: { enabled: false },
      postgres_changes: [],
    },
  }
}

async function joinChannel(
  ws: WebSocket,
  messages: unknown[],
  topic: string,
  ref: string,
  payload: Record<string, unknown>,
): Promise<PhoenixV2> {
  ws.send(JSON.stringify(['1', ref, topic, 'phx_join', payload]))
  return waitForMessage<PhoenixV2>(messages, (m) => isPhoenix(m, topic, 'phx_reply', ref))
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Realtime setAuth', () => {
  test('drops the socket, never reconnects with stale credentials, and setAuth(null) restores the API key', async () => {
    const topic = uniqueTopic('drop')
    const observer = await rawRealtimeSocket(origin, anonKey, RealWebSocket)
    const client: SinopebaseClient = createClient(origin, anonKey)

    try {
      await joinChannel(observer.ws, observer.messages, topic, '1', joinPayload())
      const channel = client.realtime.channel(topic)

      // 1. Connect with the anon key: the join and track work, and the
      //    observer sees the presence join — proof the server accepted it.
      await channel.subscribe(() => {})
      expect(client.realtime.isConnected()).toBe(true)
      expect(createdUrls).toHaveLength(1)
      expect(createdUrls[0]).toContain(`apikey=${encodeURIComponent(anonKey)}`)

      channel.track('user1', { online: true })
      const joinDiff = await waitForMessage<PhoenixV2>(
        observer.messages,
        (m) => isPhoenix(m, topic, 'presence_diff') && (m as PhoenixV2)[4]?.joins !== undefined,
      )
      expect(joinDiff[4]).toMatchObject({ joins: { user1: expect.anything() } })

      // 2. setAuth with an invalid token drops the live socket immediately.
      client.realtime.setAuth(invalidToken)
      await pollUntil(() => !client.realtime.isConnected())
      // The closed connection's presence leave reaches the observer.
      await waitForMessage(observer.messages, (m) => {
        if (!isPhoenix(m, topic, 'presence_diff')) return false
        const leaves = (m as PhoenixV2)[4]?.leaves as Record<string, unknown> | undefined
        return leaves?.user1 !== undefined
      })

      // 3. No automatic reconnect with the old credentials.
      await Bun.sleep(1000)
      expect(createdUrls).toHaveLength(1)

      // 4. Reconnecting uses the new token — and the server rejects it:
      //    the track produces no presence join at the observer.
      await channel.subscribe(() => {})
      expect(createdUrls).toHaveLength(2)
      expect(createdUrls[1]).toContain('invalid-token')
      expect(createdUrls[1]).not.toContain(`apikey=${encodeURIComponent(anonKey)}`)

      const quietFrom = observer.messages.length
      channel.track('user1', { online: true })
      await Bun.sleep(700)
      expect(observer.messages.length).toBe(quietFrom)

      // 5. setAuth(null) restores the anon key: reconnect + track works again.
      client.realtime.setAuth(null)
      await channel.subscribe(() => {})
      expect(createdUrls).toHaveLength(3)
      expect(createdUrls[2]).toContain(`apikey=${encodeURIComponent(anonKey)}`)

      const fromIndex = observer.messages.length
      channel.track('user1', { online: true })
      const rejoinDiff = await waitForMessage<PhoenixV2>(
        observer.messages,
        (m, i) => i >= fromIndex && isPhoenix(m, topic, 'presence_diff'),
      )
      expect(rejoinDiff[4]).toMatchObject({ joins: { user1: expect.anything() } })
    } finally {
      client.realtime.disconnect()
      observer.close()
    }
  })
})
