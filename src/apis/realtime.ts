/**
 * Realtime WebSocket Handler
 *
 * Implements Phoenix Channels protocol at /realtime/v1/websocket
 * for topic-based pub/sub messaging.
 *
 * Protocol:
 *   phx_join     — Subscribe to a topic. Server responds with phx_reply { status: "ok" }.
 *   broadcast    — Relay a message to all subscribers of the topic (including sender).
 *   phx_leave    — Unsubscribe from a topic.
 *   phx_heartbeat — Keep-alive; server responds with phx_reply { status: "ok" }.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PhoenixMessage {
  topic: string
  event: string
  payload: Record<string, unknown>
  ref?: string | null
}

interface BroadcastPayload {
  type: string
  event: string
  payload: unknown
}

/**
 * Minimal interface for the WebSocket client methods we need.
 * Compatible with ElysiaWS (and the underlying Bun ServerWebSocket).
 */
interface WSClient {
  send(data: unknown): void
  subscribe(topic: string): void
  unsubscribe(topic: string): void
  publish(topic: string, data: unknown): void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPhoenixMessage(value: unknown): value is PhoenixMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'topic' in value &&
    'event' in value
  )
}

function phxReply(msg: PhoenixMessage, status: string): Record<string, unknown> {
  return {
    topic: msg.topic,
    event: 'phx_reply',
    payload: { status },
    ref: msg.ref ?? null,
  }
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

/**
 * Create the WebSocket handler configuration for Elysia's .ws() method.
 *
 * Usage:
 *   app.ws('/realtime/v1/websocket', createRealtimeWebSocketHandler())
 */
export function createRealtimeWebSocketHandler() {
  return {
    open(_ws: WSClient): void {
      // Connection opened — no special handling needed.
      // The client will send phx_join to subscribe to a topic.
    },

    message(ws: WSClient, rawMessage: unknown): void {
      if (!isPhoenixMessage(rawMessage)) return

      const msg = rawMessage
      const { topic, event, payload } = msg

      switch (event) {
        // ── Subscribe ──
        case 'phx_join': {
          ws.subscribe(topic)
          ws.send(phxReply(msg, 'ok'))
          break
        }

        // ── Unsubscribe ──
        case 'phx_leave': {
          ws.unsubscribe(topic)
          ws.send(phxReply(msg, 'ok'))
          break
        }

        // ── Heartbeat ──
        case 'phx_heartbeat': {
          ws.send(phxReply(msg, 'ok'))
          break
        }

        // ── Broadcast — relay to all subscribers including sender ──
        case 'broadcast': {
          const broadcastPayload = payload as BroadcastPayload | undefined
          const innerPayload = broadcastPayload?.payload

          if (innerPayload !== undefined) {
            const response = {
              topic,
              event: 'broadcast',
              payload: innerPayload,
            }

            // Send to all subscribers of this topic (except self by default)
            ws.publish(topic, JSON.stringify(response))
            // Send to self (echo back so the sender also receives the broadcast)
            ws.send(JSON.stringify(response))
          }
          break
        }
      }
    },

    close(_ws: WSClient, _code: number, _reason: string): void {
      // Bun automatically cleans up topic subscriptions on disconnect.
    },
  }
}
