# @sinopebase/sdk

Thin supabase-js compatible client for [Sinopebase](https://github.com/KalvexDotDev/sinopebase) backends.

## Install

```bash
npm install @sinopebase/sdk
```

## Usage

```ts
import { createClient } from '@sinopebase/sdk'

const sb = createClient('https://your-sinopebase.railway.app', 'your-anon-key')

// Database
const { data } = await sb.from('todos').select('*')

// Auth
const { data: { user } } = await sb.auth.signInWithPassword({ email, password })

// Storage
const { data } = await sb.storage.from('avatars').upload('photo.png', file)

// Realtime
const channel = sb.channel('room-1')
channel.on('broadcast', { event: 'message' }, (payload) => console.log(payload))
channel.subscribe()

// Edge Functions
const { data } = await sb.functions.invoke('hello', { body: { name: 'World' } })

// RPC — rows by default
const { data: rows } = await sb.rpc('get_visible_items')

// RPC — single value
const { data: total } = await sb.rpc<number>('count_visible', {}, { get: true })
```

## Versioning

The SDK package version tracks the Sinopebase repository release tag. When a
`vX.Y.Z` tag is pushed, the release workflow publishes `@sinopebase/sdk@X.Y.Z`
to npm.

- The checked-in source is prepared for v0.10.0.
- After the `v0.10.0` tag is published, pin `@sinopebase/sdk@0.10.0` with the matching server image.

The repository `package.json` version is the Sinopebase server release
version, not the SDK version.

## License

MIT
