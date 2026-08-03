/**
 * Realtime Client (stub — implemented in Phase 4)
 *
 * Mirrors @supabase/realtime-js.
 * Backend speaks Phoenix Channels protocol at /realtime/v1/websocket.
 */

export interface RealtimeClient {
  channel(topic: string): RealtimeChannel
  connect(): void
  disconnect(): void
}

export interface RealtimeChannel {
  on(
    event: 'broadcast' | 'presence' | 'postgres_changes',
    filter: Record<string, unknown>,
    callback: (payload: unknown) => void,
  ): this
  subscribe(callback?: (status: string) => void): Promise<void>
  unsubscribe(): void
  send(payload: unknown): void
  /**
   * Track a presence state for this channel.
   * Sends a `track` message to the server with the given key and data.
   * The server broadcasts a `presence_diff` to other subscribers.
   */
  track(key: string, data?: Record<string, unknown>): void
  /**
   * Untrack a presence state for this channel.
   * Sends an `untrack` message to the server.
   */
  untrack(key?: string): void
}
