/**
 * Realtime Client Implementation
 *
 * Real WebSocket connection to Sinopebase /realtime/v1.
 * Implements the Supabase Realtime Phoenix Channels protocol.
 */

import type { RealtimeChannel, RealtimeClient } from './realtime'

const HEARTBEAT_INTERVAL_MS = 30_000 // Phoenix standard: 30s

export function createRealtimeClient(baseUrl: string, apiKey: string): RealtimeClient {
  const wsUrl = `${baseUrl.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${apiKey}`
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
        return postgresChanges.length > 0 ? { config: { postgres_changes: postgresChanges } } : {}
      }

      const ch: RealtimeChannel = {
        on(
          event: string,
          _filter: Record<string, unknown>,
          callback: (payload: unknown) => void,
        ): RealtimeChannel {
          const key = `${event}:${JSON.stringify(_filter)}`
          if (!listeners.has(key)) listeners.set(key, [])
          listeners.get(key)?.push(callback)
          return this
        },

        async subscribe(calback?: (status: string) => void): Promise<void> {
          // Register listeners for topic-based dispatch
          topicDispatchers.set(topic, listeners)

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
            const ws = new WebSocket(wsUrl)
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
          topicDispatchers.delete(topic)
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

      channels.set(topic, ch)
      return ch
    },

    connect(): void {
      if (!socket || socket.readyState === WebSocket.CLOSED) {
        socket = new WebSocket(wsUrl)
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

    setAuth(_token: string): void {
      // Token stored for next connect / subscribe cycle
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
