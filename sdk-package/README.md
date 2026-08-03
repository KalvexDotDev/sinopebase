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
```

## License

MIT
