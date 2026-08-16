/**
 * Realtime Client Implementation
 *
 * Real WebSocket connection to Sinopebase /realtime/v1.
 * Implements the Supabase Realtime Phoenix Channels protocol.
 */

import type { RealtimeChannel, RealtimeClient } from './realtime'

const HEARTBEAT_INTERVAL_MS = 30_000 // Phoenix standard: 30s

export function createRealtimeClient(baseUrl: string, apiKey: string): RealtimeClient {
  let authToken = apiKey
  /** Session token sent as `access_token` on phx_join so postgres_changes
   *  delivery passes the server's RLS check (supabase-js parity). */
  let accessToken: string | null = null
  function wsUrl(): string {
    return `${baseUrl.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(authToken)}`
  }
  let socket: WebSocket | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  const channels = new Map<string, RealtimeChannel>()

  // Topic-keyed dispatch: maps topic → listeners so multiple channels
  // on the same socket receive only their own messages.
  const topicDispatchers = new Map<string, Map<string, Array<(payload: unknown) => void>>>()

  function startHeartbeat(): void {
    stopHeartbeat()
    heartbeatTimer = setInterval(() => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            topic: 'phoenix',
            event: 'phx_heartbeat',
            payload: {},
            ref: Math.random().toString(36).slice(2),
          }),
        )
      }
    }, HEARTBEAT_INTERVAL_MS)
  }

  function stopHeartbeat(): void {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  }

  // Shared message handler — routes by msg.topic to per-channel listeners.
  function handleMessage(event: MessageEvent): void {
    const msg = JSON.parse(event.data as string)
    if (msg.event === 'phx_reply') return
    if (msg.event === 'heartbeat') return

    const topicKey = msg.topic as string | undefined
    if (!topicKey) return
    const listeners = topicDispatchers.get(topicKey)
    if (!listeners) return

    for (const [key, cbs] of listeners) {
      const colonIdx = key.indexOf(':')
      const eventType = key.slice(0, colonIdx)
      let filter: Record<string, unknown> = {}
      try {
        filter = JSON.parse(key.slice(colonIdx + 1))
      } catch {
        /* empty filter */
      }

      if (eventType === 'broadcast' && msg.event === 'broadcast') {
        const envelope = msg.payload as Record<string, unknown> | undefined
        if (envelope?.type !== 'broadcast') continue
        if (filter.event !== undefined && filter.event !== envelope.event) continue
        for (const cb of cbs) cb(envelope)
      } else {
        // Pass through: postgres_changes, presence, system
        for (const cb of cbs) cb(msg.payload)
      }
    }
  }

  return {
    channel(topic: string): RealtimeChannel {
      const listeners = new Map<string, Array<(payload: unknown) => void>>()
      let subscribed = false

      // Build the phx_join payload from the registered listeners.
      function joinPayload(): Record<string, unknown> {
        const postgresChanges: unknown[] = []
        for (const key of listeners.keys()) {
          if (!key.startsWith('postgres_changes:')) continue
          const colonIdx = key.indexOf(':')
          try {
            postgresChanges.push(JSON.parse(key.slice(colonIdx + 1)))
          } catch {
            // Malformed filter — skip rather than fail the join.
          }
        }
        const payload: Record<string, unknown> =
          postgresChanges.length > 0 ? { config: { postgres_changes: postgresChanges } } : {}
        if (accessToken) payload.access_token = accessToken
        return payload
      }

      const ch: RealtimeChannel = {
        on(
          event: string,
          _filter: Record<string, unknown>,
          callback: (payload: any) => void,
        ): RealtimeChannel {
          const key = `${event}:${JSON.stringify(_filter)}`
          if (!listeners.has(key)) listeners.set(key, [])
          listeners.get(key)?.push(callback)
          return this
        },

        subscribe(calback?: (status: string) => void): RealtimeChannel {
          // supabase-js parity: fire the async join in the background and
          // return the channel immediately so callers can chain.
          void (async () => {
          // Register listeners for topic-based dispatch.
          // Merge into existing listeners when multiple channels share a topic
          // (e.g. one channel tracks presence, another observes it). Copies,
          // never shared references — unsubscribe() of one channel must not
          // mutate another channel's callback lists.
          if (!subscribed) {
            const existing = topicDispatchers.get(topic)
            if (existing) {
              for (const [key, cbs] of listeners) {
                const merged = existing.get(key)
                if (merged) merged.push(...cbs)
                else existing.set(key, [...cbs])
              }
            } else {
              topicDispatchers.set(topic, new Map(listeners))
            }
          }

          // If we have an existing open socket, reuse it
          if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(
              JSON.stringify({
                topic,
                event: 'phx_join',
                payload: joinPayload(),
                ref: Math.random().toString(36).slice(2),
              }),
            )
            calback?.('SUBSCRIBED')
            subscribed = true
            return
          }

          // Create new socket and wait for it to open
          try {
            const ws = new WebSocket(wsUrl())
            socket = ws

            // Set up shared message handler — routes by topic
            ws.onmessage = handleMessage

            // Wait for the socket to open
            await new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(() => {
                reject(new Error('WebSocket connection timeout'))
              }, 3000)

              ws.onopen = () => {
                clearTimeout(timeout)
                startHeartbeat()
                resolve()
              }
              ws.onerror = () => {
                clearTimeout(timeout)
                reject(new Error('WebSocket connection error'))
              }
            })

            // Socket is open now — send phx_join
            socket.send(
              JSON.stringify({
                topic,
                event: 'phx_join',
                payload: joinPayload(),
                ref: Math.random().toString(36).slice(2),
              }),
            )
          } catch {
            topicDispatchers.delete(topic)
            calback?.('ERROR')
            return
          }

          calback?.('SUBSCRIBED')
          subscribed = true
          })()
          return this
        },

        unsubscribe(): void {
          if (socket && subscribed) {
            socket.send(
              JSON.stringify({
                topic,
                event: 'phx_leave',
                payload: {},
                ref: '2',
              }),
            )
          }
          // Remove only this channel's listeners from the topic dispatcher.
          // Multiple channels can share the same topic — we must not wipe the
          // other channel's callbacks.
          const existing = topicDispatchers.get(topic)
          if (existing) {
            for (const key of listeners.keys()) {
              existing.delete(key)
            }
            if (existing.size === 0) topicDispatchers.delete(topic)
          }
          subscribed = false
        },

        send(payload: unknown): void {
          if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(
              JSON.stringify({
                topic,
                event: 'broadcast',
                payload,
                ref: Math.random().toString(36).slice(2),
              }),
            )
          }
        },

        track(key: string, data?: Record<string, unknown>): void {
          if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(
              JSON.stringify({
                topic,
                event: 'track',
                payload: { key, data: data ?? {} },
                ref: Math.random().toString(36).slice(2),
              }),
            )
          }
        },

        untrack(key?: string): void {
          if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(
              JSON.stringify({
                topic,
                event: 'untrack',
                payload: key ? { key } : {},
                ref: Math.random().toString(36).slice(2),
              }),
            )
          }
        },
      }

      // First channel per topic wins — overwriting would orphan the earlier
      // channel from removeChannel() and leak its listeners.
      if (!channels.has(topic)) channels.set(topic, ch)
      return ch
    },

    connect(): void {
      if (!socket || socket.readyState === WebSocket.CLOSED) {
        socket = new WebSocket(wsUrl())
        socket.onmessage = handleMessage
        startHeartbeat()
      }
    },

    disconnect(): void {
      stopHeartbeat()
      socket?.close()
      socket = null
    },

    removeChannel(channel: RealtimeChannel): void {
      for (const [topic, ch] of channels) {
        if (ch === channel) {
          ch.unsubscribe()
          channels.delete(topic)
          return
        }
      }
    },

    removeAllChannels(): void {
      for (const ch of channels.values()) {
        ch.unsubscribe()
      }
      channels.clear()
    },

    setAuth(token: string | null): void {
      accessToken = token
      authToken = token ?? apiKey
      // Drop the live socket so the old credentials stop working immediately.
      // Channels re-join when subscribe() is called again.
      if (
        socket &&
        (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
      ) {
        stopHeartbeat()
        socket.close()
      }
    },

    sendHeartbeat(): void {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            topic: 'phoenix',
            event: 'phx_heartbeat',
            payload: {},
            ref: Math.random().toString(36).slice(2),
          }),
        )
      }
    },

    isConnected(): boolean {
      return socket?.readyState === WebSocket.OPEN
    },

    isConnecting(): boolean {
      return socket?.readyState === WebSocket.CONNECTING
    },

    isDisconnecting(): boolean {
      return socket?.readyState === WebSocket.CLOSING
    },

    connectionState(): 'OPEN' | 'CONNECTING' | 'CLOSING' | 'CLOSED' {
      const states: Record<number, 'OPEN' | 'CONNECTING' | 'CLOSING' | 'CLOSED'> = {
        [WebSocket.OPEN]: 'OPEN',
        [WebSocket.CONNECTING]: 'CONNECTING',
        [WebSocket.CLOSING]: 'CLOSING',
        [WebSocket.CLOSED]: 'CLOSED',
      }
      return states[socket?.readyState ?? WebSocket.CLOSED] ?? 'CLOSED'
    },
  }
}
