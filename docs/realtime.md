# Realtime API

Sinopebase implements the Supabase Realtime protocol over WebSockets at `/realtime/v1/websocket`.

## Connection

```ts
import { createRealtimeClient } from '@sinopebase/sdk'

const client = createRealtimeClient('https://your-instance.sinopebase.dev', 'your-anon-key')
client.connect()
```

## Channels

Subscribe to database changes, broadcast messages, and presence state per topic:

```ts
const channel = client.channel('room-1')

channel
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
    console.log('New message:', payload.new)
  })
  .on('broadcast', { event: 'chat' }, (payload) => {
    console.log('Chat:', payload)
  })
  .subscribe((status) => {
    if (status === 'SUBSCRIBED') console.log('Connected to room-1')
  })
```

## Presence

Track user presence with the Phoenix Presence protocol. The SDK sends heartbeats automatically every 30 seconds.

### Track presence state

```ts
const channel = client.channel('room-1')

channel.on('presence', { event: 'sync' }, (presenceState) => {
  // presenceState is a map: key → { metas: [{ phx_ref, key, data }] }
  console.log('Online users:', Object.values(presenceState))
})

await channel.subscribe()

// Announce this user is present
channel.track('user-123', {
  name: 'Alice',
  avatar: 'https://example.com/avatar.png',
})
```

### Untrack presence state

```ts
// Untrack a specific key
channel.untrack('user-123')

// Or untrack all keys for this client
channel.untrack()
```

### Server-side presence events

The server emits `presence_diff` messages when state changes:

| Event | Trigger |
|-------|---------|
| `presence_diff` | A client joins (track) or leaves (untrack) |
| `presence_state` | Full snapshot on `phx_join` |
| `sync` | Client has received the latest state (SDK emits this to listeners) |

### Presence lifecycle

- **Heartbeat**: The SDK sends `phx_heartbeat` every 30 seconds to keep presence entries alive.
- **Expiry**: Stale presence entries are swept every 15 seconds. Entries expire after 60 seconds without a heartbeat.
- **Cleanup**: On channel unsubscribe (`phx_leave`), all presence entries for that client are removed immediately.

## Client events reference

| Event | Direction | Description |
|-------|-----------|-------------|
| `broadcast` | client ↔ server | User-defined broadcast messages |
| `postgres_changes` | server → client | Database change notifications (INSERT/UPDATE/DELETE) |
| `presence_diff` | server → client | Incremental presence state changes |
| `presence_state` | server → client | Full presence snapshot on join |
| `sync` | SDK-internal | Presence state is synchronized |

## Configuration

The realtime hub is created with these defaults:

```ts
{
  maxDeliveryQueue: 256,          // Max queued messages per subscriber
  maxBroadcastPayloadSize: 102400, // 100 KB max broadcast payload
  maxMessagesPerMinute: 300,      // Rate limit per connection
  disableClientBroadcast: false,  // Allow clients to send broadcast messages
}
```
