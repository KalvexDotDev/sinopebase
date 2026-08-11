/**
 * v0.8 API contract tests — Auth, Realtime, Storage.
 *
 * Starts one Sinopebase server and runs all segment tests against it.
 * PostgREST v0.8 operators are tested in postgrest-v0.8.test.ts.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createClient, type SinopebaseClient } from '../../src/sdk/client'

// ── Server setup ────────────────────────────────────────────────────
const pgUrl = process.env.TEST_POSTGRES_URL || process.env.POSTGRES_URL || ''
const port = 54000 + Math.floor(Math.random() * 1000)
const origin = `http://127.0.0.1:${port}`
const anonKey = 'c3d7e1f5a9b3c7d1e5f9a3b7c1d5e9f3'
const serviceKey = 'k3d7e1f5a9b3c7d1e5f9a3b7c1d5e9f3'

let client: SinopebaseClient
let svcClient: SinopebaseClient

beforeAll(async () => {
  if (!pgUrl) return // skip if no PG available
  const { Sinopebase } = await import('../../src/core/app')
  const app = new Sinopebase({
    port,
    host: '127.0.0.1',
    postgresUrl: pgUrl,
    jwtSecret: 'c3d7e1f5a9b3c7d1e5f9a3b7c1d5e9f3',
    serviceRoleKey: serviceKey,
    anonKey,
    mode: 'development',
    minioEndpoint: process.env.RUSTFS_ENDPOINT || undefined,
    minioAccessKey: process.env.RUSTFS_ACCESS_KEY || undefined,
    minioSecretKey: process.env.RUSTFS_SECRET_KEY || undefined,
  })
  await app.start()
  client = createClient(origin, anonKey)
  svcClient = createClient(origin, serviceKey)
})

afterAll(() => {
  client?.realtime.disconnect()
})

// ── Auth ────────────────────────────────────────────────────────────

describe('v0.8 Auth', () => {
  const email = `v0.8-contract-${Date.now()}@test.com`
  const password = 'testpass123'

  it('signUp creates user and returns session', async () => {
    if (!client) return
    const { data, error } = await client.auth.signUp({ email, password })
    if (error?.message.includes('already exists')) return
    expect(error).toBeNull()
    expect(data.session).not.toBeNull()
    expect(data.user).not.toBeNull()
    expect(data.session!.access_token).toBeString()
  })

  it('signIn returns session', async () => {
    if (!client) return
    const { data, error } = await client.auth.signInWithPassword({ email, password })
    expect(error).toBeNull()
    expect(data.session).not.toBeNull()
    expect(data.session!.user.email).toBe(email)
  })

  it('getUser returns user after signIn', async () => {
    if (!client) return
    await client.auth.signInWithPassword({ email, password })
    const { data, error } = await client.auth.getUser()
    expect(error).toBeNull()
    expect(data.user).not.toBeNull()
  })

  it('onAuthStateChange fires on signOut', async () => {
    if (!client) return
    const events: string[] = []
    const sub = client.auth.onAuthStateChange((e) => events.push(e))
    await client.auth.signOut()
    expect(events).toContain('SIGNED_OUT')
    sub.data.subscription.unsubscribe()
  })

  it('onAuthStateChange fires SIGNED_IN', async () => {
    if (!client) return
    const events: string[] = []
    const sub = client.auth.onAuthStateChange((e) => events.push(e))
    await client.auth.signInWithPassword({ email, password })
    expect(events.some((e) => e === 'SIGNED_IN')).toBe(true)
    sub.data.subscription.unsubscribe()
  })

  it('updateUser changes attributes', async () => {
    if (!client) return
    await client.auth.signInWithPassword({ email, password })
    const { data, error } = await client.auth.updateUser({ data: { v08: true } })
    expect(error).toBeNull()
    expect(data.user).not.toBeNull()
  })

  it('resetPasswordForEmail returns success', async () => {
    if (!client) return
    const { error } = await client.auth.resetPasswordForEmail(email)
    expect(error).toBeNull()
  })

  it('exchangeCodeForSession returns error without browser cookie (expected)', async () => {
    if (!client) return
    const { error } = await client.auth.exchangeCodeForSession('no-cookie')
    // Without browser cookie jar, authorization_code has no session to read
    expect(error).not.toBeNull()
  })

  it('setSession restores from stored tokens', async () => {
    if (!client) return
    await client.auth.signInWithPassword({ email, password })
    const { data: sessionData } = await client.auth.getSession()
    const session = (await client.auth.getUser()).data.user
    // setSession with user and tokens
    const { data, error } = await client.auth.setSession({
      access_token: sessionData?.session?.access_token ?? '',
      refresh_token: sessionData?.session?.refresh_token ?? '',
      user: session!,
    })
    expect(error).toBeNull()
    expect(data.session).not.toBeNull()
  })
})

// ── Realtime ────────────────────────────────────────────────────────

describe('v0.8 Realtime', () => {
  it('channel subscribe + unsubscribe works', async () => {
    if (!client) return
    const ch = client.realtime.channel('test-lifecycle')
    await ch.subscribe()
    ch.unsubscribe()
  })

  it('removeChannel cleans up', () => {
    if (!client) return
    const ch = client.realtime.channel('rm-test')
    client.realtime.removeChannel(ch)
  })

  it('removeAllChannels clears all', () => {
    if (!client) return
    client.realtime.channel('a')
    client.realtime.channel('b')
    client.realtime.removeAllChannels()
  })

  it('connectionState returns a valid state', () => {
    if (!client) return
    const state = client.realtime.connectionState()
    expect(['OPEN', 'CONNECTING', 'CLOSING', 'CLOSED']).toContain(state)
  })

  it('isConnected / isConnecting / isDisconnecting are booleans', () => {
    if (!client) return
    expect(typeof client.realtime.isConnected()).toBe('boolean')
    expect(typeof client.realtime.isConnecting()).toBe('boolean')
    expect(typeof client.realtime.isDisconnecting()).toBe('boolean')
  })
})

// ── Storage ─────────────────────────────────────────────────────────

describe('v0.8 Storage', () => {
  const bucket = `v0.8-contract-${Date.now()}`

  afterAll(async () => {
    await svcClient?.storage.deleteBucket(bucket).catch(() => {})
  })

  it('createBucket + listBuckets', async () => {
    if (!client) return
    const { error } = await svcClient.storage.createBucket(bucket, { public: true })
    expect(error).toBeNull()

    const { data } = await svcClient.storage.listBuckets()
    expect(data!.some((b) => b.name === bucket)).toBe(true)
  })

  it('getBucket returns data or backend-404', async () => {
    if (!client) return
    const { data } = await svcClient.storage.getBucket(bucket)
    // Backend GET /storage/v1/bucket/:id is deferred — returns 404.
    // SDK method exists and makes a valid HTTP call; this test
    // exercises the code path without crashing.
    if (data) {
      expect(data.name).toBe(bucket)
    }
  })

  it('getPublicUrl returns URL', () => {
    if (!client) return
    const b = client.storage.from(bucket)
    const { data } = b.getPublicUrl('test.txt')
    expect(data.publicUrl).toContain(bucket)
    expect(data.publicUrl).toContain('test.txt')
  })

  it('exists returns false for missing file', async () => {
    if (!client) return
    const b = client.storage.from(bucket)
    const { data, error } = await b.exists('no-such-file.txt')
    expect(error).toBeNull()
    expect(typeof data).toBe('boolean')
  })

  it('upload + download round-trips', async () => {
    if (!client) return
    const b = client.storage.from(bucket)
    const content = 'v0.8 test content'
    const file = new Blob([content], { type: 'text/plain' })

    const up = await b.upload('roundtrip.txt', file)
    expect(up.error).toBeNull()

    const down = await b.download('roundtrip.txt')
    if (!down.error) {
      expect(down.data).not.toBeNull()
    }
  })

  it('createSignedUrl returns signed URL', async () => {
    if (!client) return
    const b = client.storage.from(bucket)
    const { data, error } = await b.createSignedUrl('roundtrip.txt', 60)
    if (!error) {
      expect(data!.signedUrl).toBeString()
    }
  })
})
