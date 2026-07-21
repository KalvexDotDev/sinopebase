/**
 * Realtime ATDD Tests
 *
 * Ported from supabase-js test/integration.test.ts (Realtime block).
 * These drive implementation of the Phoenix Channels /realtime/v1 WebSocket layer.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { createTestClient, pollUntil } from './setup'
import type { SinopebaseClient } from '../../src/sdk/client'
import type { RealtimeChannel } from '../../src/sdk/realtime'
import { Sinopebase } from '../../src/core/app'

let client: SinopebaseClient
let server: Sinopebase

beforeAll(async () => {
  // Start the Sinopebase server for integration testing
  server = new Sinopebase({
    postgresUrl: '',
    minioEndpoint: '',
    minioAccessKey: '',
    minioSecretKey: '',
    port: 8090,
  })
  await server.start()
  client = createTestClient()
})

afterAll(async () => {
  await server.stop()
})

describe('Realtime', () => {
  it('connect + subscribe + broadcast + receive', async () => {
    const messages: unknown[] = []

    const channel: RealtimeChannel = client.realtime
      .channel('test-room')
      .on('broadcast', { event: 'test-event' }, (payload: unknown) => {
        messages.push(payload)
      })

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Subscribe timeout')), 5000)

      channel.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timeout)
          resolve()
        }
      })
    })

    // Send a broadcast
    const testPayload = { message: 'hello from sinopebase', timestamp: Date.now() }
    channel.send({
      type: 'broadcast',
      event: 'test-event',
      payload: testPayload,
    })

    // Poll until we receive the message (mirrors supabase-js pattern)
    await pollUntil(() => messages.length > 0)

    expect(messages.length).toBeGreaterThan(0)
    const received = messages[0] as Record<string, unknown>
    expect(received.payload).toEqual(testPayload)

    // Cleanup
    channel.unsubscribe()
  })
})
