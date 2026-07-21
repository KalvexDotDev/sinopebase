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
}
