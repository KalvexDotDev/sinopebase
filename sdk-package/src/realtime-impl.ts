/**
 * Realtime Client Implementation
 *
 * Real WebSocket connection to Sinopebase /realtime/v1.
 * Implements the Supabase Realtime Phoenix Channels protocol.
 */

import type { RealtimeChannel, RealtimeClient } from './realtime'

export function createRealtimeClient(baseUrl: string, apiKey: string): RealtimeClient {
  const wsUrl = `${baseUrl.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${apiKey}`
  let socket: WebSocket | null = null

  return {
    channel(topic: string): RealtimeChannel {
      const listeners = new Map<string, Array<(payload: unknown) => void>>()
      let subscribed = false

      return {
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

        async subscribe(callback?: (status: string) => void): Promise<void> {
          // If we have an existing open socket, reuse it
          if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(
              JSON.stringify({
                topic,
                event: 'phx_join',
                payload: {},
                ref: Math.random().toString(36).slice(2),
              }),
            )
            callback?.('SUBSCRIBED')
            subscribed = true
            return
          }

          // Create new socket and wait for it to open
          try {
            const ws = new WebSocket(wsUrl)
            socket = ws

            // Set up message handler BEFORE waiting for open
            // (so we don't miss messages that arrive immediately after join)
            ws.onmessage = (event) => {
              const msg = JSON.parse(event.data as string)
              // phx_reply is subscription handshake — do not dispatch to
              // broadcast/presence/changes channel listeners.
              if (msg.event === 'phx_reply') return
              if (msg.event === 'heartbeat') return

              // Dispatch to matching listeners based on event type.
              // The key format is "<eventType>:<JSON-stringified filter>".
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
                  // msg.payload is the broadcast envelope:
                  //   { type: 'broadcast', event: '<name>', payload: <user-data> }
                  // Filter by the broadcast event name, then pass the
                  // envelope to the callback (Supabase Realtime contract).
                  const envelope = msg.payload as Record<string, unknown> | undefined
                  if (envelope?.type !== 'broadcast') continue
                  if (filter.event !== undefined && filter.event !== envelope.event) continue
                  for (const cb of cbs) cb(envelope)
                } else {
                  // Pass through: postgres_changes, presence, system, and
                  // any event types that don't need special unwrapping.
                  for (const cb of cbs) cb(msg.payload)
                }
              }
            }

            // Wait for the socket to open
            await new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(() => {
                reject(new Error('WebSocket connection timeout'))
              }, 3000)

              ws.onopen = () => {
                clearTimeout(timeout)
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
                payload: {},
                ref: Math.random().toString(36).slice(2),
              }),
            )
          } catch {
            callback?.('ERROR')
            return
          }

          callback?.('SUBSCRIBED')
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
    },

    connect(): void {
      if (!socket || socket.readyState === WebSocket.CLOSED) {
        socket = new WebSocket(wsUrl)
      }
    },

    disconnect(): void {
      socket?.close()
      socket = null
    },
  }
}
