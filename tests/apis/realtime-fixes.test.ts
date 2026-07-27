/**
 * Comprehensive regression tests for all HIGH + MEDIUM priority fixes
 * from the Realtime 3-review.
 *
 * Source file: src/apis/realtime.ts
 *
 * Coverage:
 *  HIGH — #1  error logging on processMessage failure
 *  HIGH — #2  per-delivery try/catch — single ws.send failure doesn't break batch
 *  HIGH — #3  heartbeat re-validates with stored lastToken
 *  HIGH — #4  canJoinTopic hook rejects unauthorized topics
 *  HIGH — #5  canBroadcast hook rejects unauthorized events
 *  HIGH — #6  constructor throws in production without authorize callback
 *  HIGH — #7  doc clarification (queue is per-batch, not persistent) — verified by reading
 *  HIGH — #8  broadcast.self:false skips sender echo
 *  MED  — #9  object-format encode includes join_ref
 *  MED  — #10 empty topic, empty schema, null broadcast payload rejected
 *  MED  — #11 schema wildcard gate (allowSchemaWildcard option)
 *  MED  — #12 type safety — replaced unsafe double-cast with direct access
 */

import { afterAll, describe, expect, it } from 'bun:test'
import { type PostgresChange, RealtimeHub } from '../../src/apis/realtime'

// ---------------------------------------------------------------------------
// Test socket double
// ---------------------------------------------------------------------------

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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse the last message sent to the socket as JSON. */
function lastSentJson(socket: TestSocket): unknown {
  expect(socket.sent.length).toBeGreaterThan(0)
  return JSON.parse(socket.sent[socket.sent.length - 1] as string)
}

/** Assert the last sent message is a phx_reply with the given status. */
function expectPhoenixReply(socket: TestSocket, status: string, reason?: string): void {
  const raw = socket.sent[socket.sent.length - 1]
  expect(typeof raw).toBe('string')
  const parsed = JSON.parse(raw as string)
  // Accept both v2 (array) and object format
  if (Array.isArray(parsed)) {
    expect(parsed[3]).toBe('phx_reply')
    expect(parsed[4]).toMatchObject(reason ? { status, response: { reason } } : { status })
  } else {
    const map = parsed as Record<string, unknown>
    expect(map.event).toBe('phx_reply')
    expect(map.payload).toMatchObject(reason ? { status, response: { reason } } : { status })
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RealtimeHub — HIGH priority fixes', () => {
  // ── Fix #1: Error logging ──────────────────────────────────────────────
  describe('Fix #1 — error logging on processMessage failure', () => {
    it('logs an error when processMessage throws', async () => {
      const errors: unknown[] = []
      const origError = console.error
      console.error = (...args: unknown[]) => {
        errors.push(...args)
      }

      try {
        const hub = new RealtimeHub<string>({
          authorize: async () => {
            throw new Error('simulated auth failure')
          },
        })
        const client = new TestSocket('key')

        await hub.handleMessage(client, [
          '1',
          '1',
          'realtime:test',
          'phx_join',
          { config: { postgres_changes: [] } },
        ])

        expect(errors.length).toBeGreaterThan(0)
        const all = errors.map(String).join(' ')
        expect(all).toContain('[realtime]')
        expect(all).toContain('simulated auth failure')
      } finally {
        console.error = origError
      }
    })
  })

  // ── Fix #2: Per-delivery try/catch ─────────────────────────────────────
  describe('Fix #2 — single ws.send failure does not kill batch', () => {
    it('delivers to remaining clients when one ws.send throws', async () => {
      const hub = new RealtimeHub()
      const good = new TestSocket('good')
      const bad = new TestSocket('bad')

      // Both clients subscribe to the same filter.
      const joinPayload = {
        config: {
          postgres_changes: [{ event: '*', schema: 'public', table: 'items' }],
        },
      }
      await hub.handleMessage(good, ['1', '1', 'realtime:test', 'phx_join', joinPayload])
      await hub.handleMessage(bad, ['1', '1', 'realtime:test', 'phx_join', joinPayload])

      // Clear phx_reply messages.
      good.sent.length = 0

      // Replace bad client's send to throw — after join succeeded.
      let badSendCalled = false
      const origSend = bad.send.bind(bad)
      bad.send = (data: unknown) => {
        badSendCalled = true
        origSend(data)
        throw new Error('ws.send failure')
      }

      const change: PostgresChange = {
        schema: 'public',
        table: 'items',
        event: 'INSERT',
        new: { id: 'item-1' },
        old: {},
      }

      // This calls deliver() which iterates all bounded deliveries.
      await hub.publishPostgresChange(change)

      // The bad client's send was invoked (and threw).
      expect(badSendCalled).toBe(true)

      // The good client still received its postgres_changes message.
      expect(good.sent.length).toBeGreaterThan(0)
      for (const raw of good.sent) {
        const msg = JSON.parse(raw as string)
        // Should be a postgres_changes array, not an error reply.
        if (Array.isArray(msg) && msg[3] === 'postgres_changes') {
          expect((msg[4] as Record<string, unknown>).data).toBeDefined()
        }
      }
    })
  })

  // ── Fix #3: Heartbeat re-validation with stored token ──────────────────
  describe('Fix #3 — heartbeat re-validates with stored token', () => {
    it('re-validates using cached lastToken when heartbeat omits access_token', async () => {
      const authCalls: string[] = []
      const hub = new RealtimeHub<string>({
        authorize: async (token) => {
          if (token) authCalls.push(token)
          return token || undefined
        },
      })
      const client = new TestSocket('session-token')

      // Join — the token from ws.data.query.apikey is stored in lastToken.
      await hub.handleMessage(client, [
        '1',
        '1',
        'realtime:test',
        'phx_join',
        { config: { postgres_changes: [] } },
      ])

      // Reset tracking.
      authCalls.length = 0

      // Heartbeat WITHOUT access_token — should fall back to stored token.
      const sentBefore = client.sent.length
      await hub.handleMessage(client, ['2', '2', 'realtime:test', 'phx_heartbeat', {}])

      // The authorize callback was invoked with the stored token.
      expect(authCalls).toEqual(['session-token'])

      // The client received a phx_reply ok (heartbeat succeeded).
      const newMessages = client.sent.slice(sentBefore)
      const heartbeatReply = newMessages.find((raw) => {
        const parsed = JSON.parse(raw as string)
        return Array.isArray(parsed) && parsed[3] === 'phx_reply'
      })
      expect(heartbeatReply).toBeDefined()
      const parsed = JSON.parse(heartbeatReply as string)
      expect(parsed[4]).toMatchObject({ status: 'ok' })
    })

    it('evicts client when stored token has expired', async () => {
      let callCount = 0
      const hub = new RealtimeHub<string>({
        authorize: async (token) => {
          callCount++
          // First call (join) succeeds; second call (heartbeat) fails.
          return callCount === 1 ? token || undefined : undefined
        },
      })
      const client = new TestSocket('expiring-token')

      // Join — succeeds, token stored.
      await hub.handleMessage(client, [
        '1',
        '1',
        'realtime:test',
        'phx_join',
        { config: { postgres_changes: [] } },
      ])

      const sentAfterJoin = client.sent.length

      // Heartbeat without token — should use stored token, which is now expired.
      await hub.handleMessage(client, ['2', '2', 'realtime:test', 'phx_heartbeat', {}])

      // Should have received a phx_close and a phx_reply error.
      const newMessages = client.sent.slice(sentAfterJoin)
      const closeMsg = newMessages.find((raw) => {
        try {
          const p = JSON.parse(raw as string)
          return (Array.isArray(p) ? p[3] : (p as Record<string, unknown>).event) === 'phx_close'
        } catch {
          return false
        }
      })
      expect(closeMsg).toBeDefined()

      const errorReply = newMessages.find((raw) => {
        try {
          const p = JSON.parse(raw as string)
          const event = Array.isArray(p) ? p[3] : (p as Record<string, unknown>).event
          const payload = Array.isArray(p) ? p[4] : (p as Record<string, unknown>).payload
          return event === 'phx_reply' && (payload as Record<string, unknown>)?.status === 'error'
        } catch {
          return false
        }
      })
      expect(errorReply).toBeDefined()
    })
  })

  // ── Fix #4: canJoinTopic hook ──────────────────────────────────────────
  describe('Fix #4 — canJoinTopic hook', () => {
    it('rejects topic join when canJoinTopic returns false', async () => {
      const hub = new RealtimeHub<string>({
        authorize: async (token) => token || undefined,
        canJoinTopic: (_ctx, topic) => topic === 'realtime:allowed',
      })
      const client = new TestSocket('key')

      await hub.handleMessage(client, [
        '1',
        '1',
        'realtime:forbidden',
        'phx_join',
        { config: { postgres_changes: [] } },
      ])

      expectPhoenixReply(client, 'error', 'topic not authorized')
    })

    it('allows join when canJoinTopic returns true', async () => {
      const hub = new RealtimeHub<string>({
        authorize: async (token) => token || undefined,
        canJoinTopic: (_ctx, topic) => topic === 'realtime:allowed',
      })
      const client = new TestSocket('key')

      await hub.handleMessage(client, [
        '1',
        '1',
        'realtime:allowed',
        'phx_join',
        { config: { postgres_changes: [] } },
      ])

      expectPhoenixReply(client, 'ok')
    })
  })

  // ── Fix #5: canBroadcast hook ──────────────────────────────────────────
  describe('Fix #5 — canBroadcast hook', () => {
    it('rejects broadcast when canBroadcast returns false', async () => {
      const hub = new RealtimeHub<string>({
        authorize: async (token) => token || undefined,
        canBroadcast: (_ctx, _topic, event) => event === 'allowed-event',
      })
      const client = new TestSocket('key')

      // Join first.
      await hub.handleMessage(client, [
        '1',
        '1',
        'realtime:test',
        'phx_join',
        { config: { postgres_changes: [] } },
      ])
      client.sent.length = 0

      // Broadcast with a disallowed event.
      await hub.handleMessage(client, [
        '2',
        '2',
        'realtime:test',
        'broadcast',
        { type: 'broadcast', event: 'forbidden', payload: { x: 1 } },
      ])

      expectPhoenixReply(client, 'error', 'broadcast not authorized')
    })

    it('allows broadcast when canBroadcast returns true', async () => {
      const hub = new RealtimeHub<string>({
        authorize: async (token) => token || undefined,
        canBroadcast: () => true,
      })
      const client = new TestSocket('key')

      await hub.handleMessage(client, [
        '1',
        '1',
        'realtime:test',
        'phx_join',
        { config: { postgres_changes: [] } },
      ])
      client.sent.length = 0

      await hub.handleMessage(client, [
        '2',
        '2',
        'realtime:test',
        'broadcast',
        { type: 'broadcast', event: 'hello', payload: { x: 1 } },
      ])

      // No error reply — sender should receive the broadcast echo.
      expect(client.sent.length).toBeGreaterThan(0)
      for (const raw of client.sent) {
        const parsed = JSON.parse(raw as string)
        if (Array.isArray(parsed) && parsed[3] === 'phx_reply') {
          expect(parsed[4]).not.toMatchObject({ status: 'error' })
        }
      }
    })
  })

  // ── Fix #6: Production safety ──────────────────────────────────────────
  describe('Fix #6 — constructor throws in production without authorize', () => {
    const ORIG_NODE_ENV = process.env.NODE_ENV

    afterAll(() => {
      process.env.NODE_ENV = ORIG_NODE_ENV
    })

    it('throws when NODE_ENV=production and no authorize callback', () => {
      process.env.NODE_ENV = 'production'
      expect(() => new RealtimeHub()).toThrow(/authorize callback is required in production mode/)
    })

    it('does not throw when NODE_ENV=production and authorize is provided', () => {
      process.env.NODE_ENV = 'production'
      expect(() => new RealtimeHub({ authorize: async () => 'ok' })).not.toThrow()
    })

    it('does not throw when not in production even without authorize', () => {
      process.env.NODE_ENV = 'development'
      expect(() => new RealtimeHub()).not.toThrow()
    })
  })

  // ── Fix #8: broadcast.self ────────────────────────────────────────────
  describe('Fix #8 — broadcast.self:false skips sender echo', () => {
    it('skips ws.send when self is false', async () => {
      const hub = new RealtimeHub()
      const client = new TestSocket('anon')

      await hub.handleMessage(client, [
        '1',
        '1',
        'realtime:room',
        'phx_join',
        { config: { postgres_changes: [] } },
      ])
      client.sent.length = 0

      // Broadcast with self:false.
      await hub.handleMessage(client, [
        '2',
        '2',
        'realtime:room',
        'broadcast',
        { type: 'broadcast', event: 'msg', payload: { hello: true }, self: false },
      ])

      // With self:false the sender should NOT receive a broadcast echo via ws.send.
      // Any messages sent should only be phx_reply (but there's no phx_reply for broadcast).
      // The broadcast itself should NOT appear in sent because ws.send was skipped.
      const broadcastMessages = client.sent.filter((raw) => {
        const p = JSON.parse(raw as string)
        return Array.isArray(p) && p[3] === 'broadcast'
      })
      expect(broadcastMessages.length).toBe(0)
    })

    it('sends to sender when self is true (default)', async () => {
      const hub = new RealtimeHub()
      const client = new TestSocket('anon')

      await hub.handleMessage(client, [
        '1',
        '1',
        'realtime:room',
        'phx_join',
        { config: { postgres_changes: [] } },
      ])
      client.sent.length = 0

      // Broadcast without self flag (defaults to true).
      await hub.handleMessage(client, [
        '2',
        '2',
        'realtime:room',
        'broadcast',
        { type: 'broadcast', event: 'msg', payload: { hello: true } },
      ])

      // The broadcast response should be in sent (ws.send was called).
      const broadcastMessages = client.sent.filter((raw) => {
        const p = JSON.parse(raw as string)
        return Array.isArray(p) && p[3] === 'broadcast'
      })
      expect(broadcastMessages.length).toBeGreaterThan(0)
    })
  })
})

describe('RealtimeHub — MEDIUM priority fixes', () => {
  // ── Fix #9: join_ref in object format ──────────────────────────────────
  describe('Fix #9 — object format includes join_ref', () => {
    it('includes join_ref in object-format phx_reply', async () => {
      const hub = new RealtimeHub()
      const client = new TestSocket('anon')

      // Send an object-format (non-array) phx_join.
      const objectMsg = {
        join_ref: 'custom-join-ref',
        ref: 'custom-ref',
        topic: 'realtime:test',
        event: 'phx_join',
        payload: { config: { postgres_changes: [] } },
      }
      await hub.handleMessage(client, objectMsg)

      // The reply should be object-format and include join_ref.
      expect(client.sent.length).toBeGreaterThan(0)
      const lastRaw = client.sent[client.sent.length - 1]
      expect(typeof lastRaw).toBe('string')
      const parsed = JSON.parse(lastRaw as string) as Record<string, unknown>

      // Object-format encoding produces a JSON object, not an array.
      expect(Array.isArray(parsed)).toBe(false)
      expect(parsed.topic).toBe('realtime:test')
      expect(parsed.event).toBe('phx_reply')
      expect(parsed.payload).toMatchObject({ status: 'ok' })
      // join_ref should be present (Fix #9).
      expect(parsed.join_ref).toBe('custom-join-ref')
      // ref should also be present.
      expect(parsed.ref).toBe('custom-ref')
    })
  })

  // ── Fix #10: Validation — empty topic, empty schema, null payload ──────
  describe('Fix #10 — validation rejects invalid inputs', () => {
    it('rejects empty topic in v2 (array) format', async () => {
      const hub = new RealtimeHub()
      const client = new TestSocket('anon')

      // Empty topic string should be treated as invalid message.
      await hub.handleMessage(client, [
        '1',
        '1',
        '',
        'phx_join',
        { config: { postgres_changes: [] } },
      ])

      // The message should be silently dropped — no reply sent.
      expect(client.sent.length).toBe(0)
    })

    it('rejects empty topic in object format', async () => {
      const hub = new RealtimeHub()
      const client = new TestSocket('anon')

      await hub.handleMessage(client, {
        join_ref: '1',
        ref: '1',
        topic: '',
        event: 'phx_join',
        payload: { config: { postgres_changes: [] } },
      })

      // Silently dropped.
      expect(client.sent.length).toBe(0)
    })

    it('rejects empty schema in postgres_changes filter', async () => {
      const hub = new RealtimeHub()
      const client = new TestSocket('anon')

      await hub.handleMessage(client, [
        '1',
        '1',
        'realtime:test',
        'phx_join',
        { config: { postgres_changes: [{ event: '*', schema: '', table: 'items' }] } },
      ])

      // The join succeeds but the empty-schema filter is rejected,
      // so the bindings array should be empty.
      expect(client.sent.length).toBeGreaterThan(0)
      const reply = lastSentJson(client)
      expect(Array.isArray(reply)).toBe(true)
      if (Array.isArray(reply)) {
        const payload = reply[4] as Record<string, unknown>
        expect(payload.status).toBe('ok')
        const bindings = (payload.response as Record<string, unknown>).postgres_changes as unknown[]
        expect(bindings).toHaveLength(0)
      }
    })

    it('silently ignores broadcast with null payload', async () => {
      const hub = new RealtimeHub()
      const client = new TestSocket('anon')

      // Join the channel.
      await hub.handleMessage(client, [
        '1',
        '1',
        'realtime:test',
        'phx_join',
        { config: { postgres_changes: [] } },
      ])
      client.sent.length = 0

      // Broadcast with null payload — should be silently dropped.
      await hub.handleMessage(client, [
        '2',
        '2',
        'realtime:test',
        'broadcast',
        { type: 'broadcast', event: 'test', payload: null },
      ])

      // No broadcast message and no error reply.
      const allReplies = client.sent.filter((raw) => {
        const p = JSON.parse(raw as string)
        return Array.isArray(p)
      })
      // The only possible messages are broadcasts — none should exist.
      const broadcastMsgs = allReplies.filter((p) => (p as unknown[])[3] === 'broadcast')
      expect(broadcastMsgs.length).toBe(0)
    })

    it('silently ignores broadcast with undefined payload', async () => {
      const hub = new RealtimeHub()
      const client = new TestSocket('anon')

      await hub.handleMessage(client, [
        '1',
        '1',
        'realtime:test',
        'phx_join',
        { config: { postgres_changes: [] } },
      ])
      client.sent.length = 0

      // Omit payload entirely (undefined).
      await hub.handleMessage(client, [
        '2',
        '2',
        'realtime:test',
        'broadcast',
        { type: 'broadcast', event: 'test' },
      ])

      const broadcastMsgs = client.sent.filter((raw) => {
        const p = JSON.parse(raw as string)
        return Array.isArray(p) && (p as unknown[])[3] === 'broadcast'
      })
      expect(broadcastMsgs.length).toBe(0)
    })
  })

  // ── Fix #11: Schema wildcard gate ──────────────────────────────────────
  describe('Fix #11 — schema wildcard gate (allowSchemaWildcard)', () => {
    it('rejects schema wildcard matching when allowSchemaWildcard is false (default)', async () => {
      const hub = new RealtimeHub({ allowSchemaWildcard: false })
      const client = new TestSocket('anon')

      await hub.handleMessage(client, [
        '1',
        '1',
        'realtime:test',
        'phx_join',
        { config: { postgres_changes: [{ event: '*', schema: '*', table: 'items' }] } },
      ])

      // Join succeeds but bindings exist.
      client.sent.length = 0

      // Publish a change that would have matched the wildcard.
      await hub.publishPostgresChange({
        schema: 'public',
        table: 'items',
        event: 'INSERT',
        new: { id: '1' },
        old: {},
      })

      // Client should NOT receive the change (schema wildcard rejected).
      expect(client.sent.length).toBe(0)
    })

    it('allows schema wildcard matching when allowSchemaWildcard is true', async () => {
      const hub = new RealtimeHub({ allowSchemaWildcard: true })
      const client = new TestSocket('anon')

      await hub.handleMessage(client, [
        '1',
        '1',
        'realtime:test',
        'phx_join',
        { config: { postgres_changes: [{ event: '*', schema: '*', table: 'items' }] } },
      ])

      client.sent.length = 0

      await hub.publishPostgresChange({
        schema: 'public',
        table: 'items',
        event: 'INSERT',
        new: { id: '1' },
        old: {},
      })

      // Client SHOULD receive the change.
      expect(client.sent.length).toBeGreaterThan(0)
      const msg = JSON.parse(client.sent[0] as string)
      expect(Array.isArray(msg)).toBe(true)
      if (Array.isArray(msg)) {
        expect(msg[3]).toBe('postgres_changes')
      }
    })

    it('rejects schema wildcard by default (option not set)', async () => {
      const hub = new RealtimeHub() // allowSchemaWildcard not set → false
      const client = new TestSocket('anon')

      await hub.handleMessage(client, [
        '1',
        '1',
        'realtime:test',
        'phx_join',
        { config: { postgres_changes: [{ event: '*', schema: '*', table: 'items' }] } },
      ])

      client.sent.length = 0

      await hub.publishPostgresChange({
        schema: 'public',
        table: 'items',
        event: 'INSERT',
        new: { id: '1' },
        old: {},
      })

      expect(client.sent.length).toBe(0)
    })
  })
})
