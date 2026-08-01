/**
 * Realtime Presence ATDD Contract Tests
 *
 * Contract for the presence feature in src/apis/realtime.ts and the SDK
 * surface in src/sdk/realtime-impl.ts (channel.track / channel.untrack).
 *
 * Wire contract (Phoenix v2):
 * - phx_join may carry TOP-LEVEL `presence: { key }` plus `data` — the
 *   server auto-tracks and returns `presence_state` in the phx_reply
 * - `track` messages: payload { key, data } — registers presence,
 *   broadcasts `presence_diff` with `joins`
 * - `untrack` messages: payload { key } — removes presence,
 *   broadcasts `presence_diff` with `leaves`
 * - Disconnect/phx_leave removes the client's presences, broadcasts leaves
 * - Stale presences expire after 60s timeout (swept every 15s)
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Sinopebase } from '../../src/core/app'
import { RealtimeHub } from '../../src/apis/realtime'
import { createClient } from '../../src/sdk/client'
import { requireAnonKey, requirePostgres, reserveLoopbackPort } from '../harness'

let server: Sinopebase
let origin: string
let anonKey: string

beforeAll(async () => {
  const portReservation = await reserveLoopbackPort()
  anonKey = requireAnonKey()
  server = new Sinopebase({
    postgresUrl: requirePostgres(),
    port: portReservation.port,
  })
  await portReservation.release()
  await server.start()
  origin = portReservation.origin
})

afterAll(async () => {
  await server.stop()
})

// ── Helper: raw WebSocket for protocol-level testing ───────────────────────

async function rawRealtimeSocket(baseUrl: string, apiKey: string) {
  const messages: unknown[] = []
  const ws = new WebSocket(
    `${baseUrl.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${apiKey}&vsn=2.0.0`,
  )
  ws.onmessage = (event) => {
    try {
      messages.push(JSON.parse(event.data as string))
    } catch {
      /* ignore */
    }
  }
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = () => reject(new Error('WebSocket connection failed'))
  })
  return { ws, messages, close: () => ws.close() }
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
  return `realtime:presence-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function joinPayload(presence?: { key: string }, data?: Record<string, unknown>) {
  const payload: Record<string, unknown> = {
    config: {
      broadcast: { ack: false, self: false },
      presence: { enabled: presence !== undefined },
      postgres_changes: [],
    },
  }
  if (presence) {
    payload.presence = presence
    payload.data = data ?? {}
  }
  return payload
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

function sendTrack(
  ws: WebSocket,
  topic: string,
  key: string,
  data: Record<string, unknown>,
  ref = '2',
) {
  ws.send(JSON.stringify(['1', ref, topic, 'track', { key, data }]))
}

function sendUntrack(ws: WebSocket, topic: string, key?: string, ref = '3') {
  ws.send(JSON.stringify(['1', ref, topic, 'untrack', key ? { key } : {}]))
}

function waitForPresenceDiff(
  messages: unknown[],
  topic: string,
  fromIndex = 0,
): Promise<PhoenixV2> {
  return waitForMessage<PhoenixV2>(
    messages,
    (m, i) => i >= fromIndex && isPhoenix(m, topic, 'presence_diff'),
  )
}

// ── Test socket double (for heartbeat sweeper test) ────────────────────────

class TestSocket {
  readonly sent: unknown[] = []
  readonly data: { query: { apikey: string } }
  id?: string

  constructor(apiKey: string) {
    this.data = { query: { apikey: apiKey } }
  }

  send(data: unknown): void {
    this.sent.push(data)
  }
  subscribe(_topic: string): void {}
  unsubscribe(_topic: string): void {}
  publish(_topic: string, _data: unknown): void {}
}

function findLastSent<T>(
  socket: TestSocket,
  predicate: (msg: PhoenixV2) => boolean,
): T | undefined {
  const parsed = socket.sent.map((raw) => JSON.parse(raw as string) as PhoenixV2)
  for (let i = parsed.length - 1; i >= 0; i--) {
    if (predicate(parsed[i] as PhoenixV2)) return parsed[i] as T
  }
  return undefined
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Realtime Presence', () => {
  test('join with presence config returns presence_state in phx_reply', async () => {
    const topic = uniqueTopic('join')
    const { ws, messages, close } = await rawRealtimeSocket(origin, anonKey)

    try {
      ws.send(
        JSON.stringify([
          '1',
          '1',
          topic,
          'phx_join',
          joinPayload({ key: 'user1' }, { online: true }),
        ]),
      )
      const reply = await waitForMessage<PhoenixV2>(messages, (m) =>
        isPhoenix(m, topic, 'phx_reply', '1'),
      )

      expect(reply[4]).toMatchObject({
        status: 'ok',
        response: { postgres_changes: expect.any(Array) },
      })
      const response = reply[4].response as Record<string, unknown>
      expect(response.presence_state).toBeDefined()
    } finally {
      close()
    }
  })

  test('track broadcasts presence_diff with joins to other subscribers', async () => {
    const topic = uniqueTopic('track')
    const a = await rawRealtimeSocket(origin, anonKey)
    const b = await rawRealtimeSocket(origin, anonKey)

    try {
      await joinChannel(a.ws, a.messages, topic, '1', joinPayload())
      await joinChannel(b.ws, b.messages, topic, '1', joinPayload())

      const fromIndex = b.messages.length
      sendTrack(a.ws, topic, 'user1', { online: true })

      const trackReply = await waitForMessage<PhoenixV2>(a.messages, (m) =>
        isPhoenix(m, topic, 'phx_reply', '2'),
      )
      expect(trackReply[4]).toMatchObject({ status: 'ok' })

      const diff = await waitForPresenceDiff(b.messages, topic, fromIndex)
      expect(diff[4]).toEqual({
        joins: { user1: { metas: [{ key: 'user1', data: { online: true } }] } },
        leaves: {},
      })
    } finally {
      a.close()
      b.close()
    }
  })

  test('untrack broadcasts presence_diff with leaves to other subscribers', async () => {
    const topic = uniqueTopic('untrack')
    const a = await rawRealtimeSocket(origin, anonKey)
    const b = await rawRealtimeSocket(origin, anonKey)

    try {
      await joinChannel(a.ws, a.messages, topic, '1', joinPayload())
      await joinChannel(b.ws, b.messages, topic, '1', joinPayload())

      sendTrack(a.ws, topic, 'user1', { online: true })
      await waitForMessage<PhoenixV2>(a.messages, (m) => isPhoenix(m, topic, 'phx_reply', '2'))

      const leavesFrom = b.messages.length
      sendUntrack(a.ws, topic, 'user1')
      await waitForMessage<PhoenixV2>(a.messages, (m) => isPhoenix(m, topic, 'phx_reply', '3'))

      const diff = await waitForPresenceDiff(b.messages, topic, leavesFrom)
      expect(diff[4]).toEqual({
        joins: {},
        leaves: { user1: { metas: [{ key: 'user1', data: { online: true } }] } },
      })
    } finally {
      a.close()
      b.close()
    }
  })

  test('presence entries cleaned up when client disconnects', async () => {
    const topic = uniqueTopic('disconnect')
    const a = await rawRealtimeSocket(origin, anonKey)
    const b = await rawRealtimeSocket(origin, anonKey)

    try {
      await joinChannel(a.ws, a.messages, topic, '1', joinPayload())
      await joinChannel(b.ws, b.messages, topic, '1', joinPayload())

      sendTrack(a.ws, topic, 'user1', { online: true })
      await waitForMessage<PhoenixV2>(a.messages, (m) => isPhoenix(m, topic, 'phx_reply', '2'))

      const fromIndex = b.messages.length
      a.close()

      const diff = await waitForPresenceDiff(b.messages, topic, fromIndex)
      expect(diff[4]).toEqual({
        joins: {},
        leaves: { user1: { metas: [{ key: 'user1', data: { online: true } }] } },
      })
    } finally {
      a.close()
      b.close()
    }
  })

  test('multiple clients tracking same key produce multiple metas', async () => {
    const topic = uniqueTopic('multi')
    const a = await rawRealtimeSocket(origin, anonKey)
    const b = await rawRealtimeSocket(origin, anonKey)
    const c = await rawRealtimeSocket(origin, anonKey)

    try {
      await joinChannel(a.ws, a.messages, topic, '1', joinPayload())
      await joinChannel(b.ws, b.messages, topic, '1', joinPayload())

      sendTrack(a.ws, topic, 'shared', { name: 'a' })
      await waitForMessage<PhoenixV2>(a.messages, (m) => isPhoenix(m, topic, 'phx_reply', '2'))
      sendTrack(b.ws, topic, 'shared', { name: 'b' })
      await waitForMessage<PhoenixV2>(b.messages, (m) => isPhoenix(m, topic, 'phx_reply', '2'))

      c.ws.send(
        JSON.stringify(['1', '1', topic, 'phx_join', joinPayload({ key: 'c' }, { online: true })]),
      )
      const cJoin = await waitForMessage<PhoenixV2>(c.messages, (m) =>
        isPhoenix(m, topic, 'phx_reply', '1'),
      )
      expect(cJoin[4]).toMatchObject({ status: 'ok' })

      const state = (cJoin[4].response as Record<string, unknown>).presence_state as Record<
        string,
        { metas: Array<{ key: string }> }
      >
      expect(Object.keys(state)).toEqual(['shared'])
      expect(state['shared']?.metas).toHaveLength(2)
      expect(state['shared']?.metas.map((m) => m.key).sort()).toEqual(['shared', 'shared'])
    } finally {
      a.close()
      b.close()
      c.close()
    }
  })

  // SKIP in CI: requires 80s wall-clock time. Run manually with:
  //   bun test -t "heartbeat" tests/integration/realtime-presence.test.ts
  test.skip('heartbeat keeps presence alive past the 60s sweep timeout', {
    timeout: 150_000,
  }, async () => {
    // Dedicated hub so the sweeper timing is fully contained in this test.
    const hub = new RealtimeHub()
    const topic = uniqueTopic('hb')

    const a = new TestSocket(anonKey)
    const b = new TestSocket(anonKey)

    // A joins with presence (auto-track user1); B joins as an observer.
    await hub.handleMessage(
      a,
      JSON.stringify([
        '1',
        '1',
        topic,
        'phx_join',
        joinPayload({ key: 'user1' }, { online: true }),
      ]),
    )
    await hub.handleMessage(b, JSON.stringify(['1', '1', topic, 'phx_join', joinPayload()]))

    // Sanity: A's join reply carries a presence_state object.
    const joinReply = findLastSent<PhoenixV2>(a, (m) => isPhoenix(m, topic, 'phx_reply', '1'))
    expect(joinReply?.[4]).toMatchObject({ status: 'ok' })
    const joinState = ((joinReply?.[4].response ?? {}) as Record<string, unknown>).presence_state
    expect(joinState).toBeDefined()

    // Wait 59s — still within the 60s presence timeout — then send a
    // heartbeat to refresh the entry's lastHeartbeat before the sweeper
    // (runs every 15s, removes entries older than 60s) can remove it.
    await Bun.sleep(59_000)
    await hub.handleMessage(a, JSON.stringify(['1', '2', topic, 'phx_heartbeat', {}]))
    const hbReply = findLastSent<PhoenixV2>(a, (m) => isPhoenix(m, topic, 'phx_reply', '2'))
    expect(hbReply?.[4]).toMatchObject({ status: 'ok' })

    // Wait past the ~75s sweep tick. Without the heartbeat the entry would
    // have been swept by now (60s timeout + 15s sweep interval); with the
    // heartbeat its lastHeartbeat was refreshed to ~59s, so it survives.
    await Bun.sleep(21_000)

    // A fresh joiner must still see user1 in presence_state.
    const c = new TestSocket(anonKey)
    await hub.handleMessage(
      c,
      JSON.stringify(['1', '1', topic, 'phx_join', joinPayload({ key: 'c' }, { online: true })]),
    )
    const reply = findLastSent<PhoenixV2>(c, (m) => isPhoenix(m, topic, 'phx_reply', '1'))
    expect(reply?.[4]).toMatchObject({ status: 'ok' })
    const state = ((reply?.[4].response ?? {}) as Record<string, unknown>).presence_state as Record<
      string,
      unknown
    >
    expect(state['user1']).toBeDefined()

    // The sweeper must never have broadcast a leave for user1 to observers.
    const swept = findLastSent<PhoenixV2>(
      b,
      (m) =>
        isPhoenix(m, topic, 'presence_diff') &&
        (m[4] as Record<string, unknown>)?.leaves !== undefined &&
        Object.keys(((m[4] as Record<string, unknown>).leaves ?? {}) as Record<string, unknown>)
          .length > 0,
    )
    expect(swept).toBeUndefined()
  })

  test('SDK track/untrack delivers presence events over HTTP', async () => {
    const topic = uniqueTopic('sdk')
    const client = createClient(origin, anonKey)

    // Two channels on the same topic: A tracks, B observes presence events.
    const channelA = client.realtime.channel(topic)
    const channelB = client.realtime.channel(topic)

    const presenceEvents: unknown[] = []
    channelB.on('presence', {}, (payload) => {
      presenceEvents.push(payload)
    })

    try {
      // B must subscribe first — the SDK binds the shared socket's message
      // dispatch to the channel that opened the socket.
      await channelB.subscribe(() => {})
      await channelA.subscribe(() => {})

      // A tracks user1 → B receives a presence_diff with joins.
      channelA.track('user1', { online: true })
      const joinEvent = await waitForMessage<{
        joins: Record<string, unknown>
        leaves: Record<string, unknown>
      }>(presenceEvents, (p) => {
        const payload = p as { joins?: Record<string, unknown> }
        return payload?.joins?.['user1'] !== undefined
      })
      expect(joinEvent.joins['user1']).toEqual({
        metas: [{ key: 'user1', data: { online: true } }],
      })

      // A untracks (no key → server falls back to the tracked key) → B
      // receives a presence_diff with leaves.
      channelA.untrack()
      const leaveEvent = await waitForMessage<{
        joins: Record<string, unknown>
        leaves: Record<string, unknown>
      }>(presenceEvents, (p) => {
        const payload = p as { leaves?: Record<string, unknown> }
        return payload?.leaves?.['user1'] !== undefined
      })
      expect(leaveEvent.leaves['user1']).toEqual({
        metas: [{ key: 'user1', data: { online: true } }],
      })
    } finally {
      client.realtime.disconnect()
    }
  })
})
