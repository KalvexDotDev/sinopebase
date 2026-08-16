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
  removeChannel(channel: RealtimeChannel): void
  removeAllChannels(): void
  /** Refresh the WebSocket auth token without reconnecting */
  /** Replace the auth token. Null restores the API key. Drops the live socket. */
  setAuth(token: string | null): void
  /** Send a heartbeat manually (auto-heartbeat still runs) */
  sendHeartbeat(): void
  /** Whether the WebSocket is currently open */
  isConnected(): boolean
  /** Whether the WebSocket is connecting */
  isConnecting(): boolean
  /** Whether the WebSocket is closing */
  isDisconnecting(): boolean
  /** Raw connection state string */
  connectionState(): 'OPEN' | 'CONNECTING' | 'CLOSING' | 'CLOSED'
}

export interface RealtimeChannel {
  on(
    event: 'broadcast' | 'presence' | 'postgres_changes',
    filter: Record<string, unknown>,
    callback: (payload: any) => void,
  ): this
  /** supabase-js parity: returns the channel for chaining; join runs in background. */
  subscribe(callback?: (status: string) => void): this
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
