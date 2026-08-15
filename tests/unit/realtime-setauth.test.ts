/**
 * realtime setAuth() — applies the new token to the next connection and
 * drops the live socket so old credentials stop working immediately.
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { createRealtimeClient } from '~/sdk/realtime-impl'

const RealWebSocket = globalThis.WebSocket

let createdUrls: string[] = []
let liveSockets: FakeWebSocket[] = []

class FakeWebSocket {
  url: string
  readyState = 1
  onmessage: ((ev: MessageEvent) => void) | null = null
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null

  static readonly OPEN = 1
  static readonly CONNECTING = 0
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  constructor(url: string) {
    this.url = url
    createdUrls.push(url)
    liveSockets.push(this)
  }

  send(_data: string): void {}
  close(): void {
    this.readyState = 3
  }
}

afterEach(() => {
  globalThis.WebSocket = RealWebSocket
  createdUrls = []
  liveSockets = []
})

describe('realtime setAuth', () => {
  it('applies the token to the next connection', () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    const client = createRealtimeClient('http://x', 'anon-key')

    client.connect()
    client.setAuth('user-token')
    client.connect()

    expect(createdUrls[0]).toContain('apikey=anon-key')
    expect(createdUrls[1]).toContain('apikey=user-token')
    client.disconnect()
  })

  it('closes the live socket so the old credentials stop working', () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    const client = createRealtimeClient('http://x', 'anon-key')

    client.connect()
    const first = liveSockets[0]
    client.setAuth('user-token')

    expect(first?.readyState).toBe(3)
    client.disconnect()
  })

  it('null restores the API key', () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    const client = createRealtimeClient('http://x', 'anon-key')

    client.setAuth('user-token')
    client.setAuth(null)
    client.connect()

    expect(createdUrls[0]).toContain('apikey=anon-key')
    client.disconnect()
  })
})
