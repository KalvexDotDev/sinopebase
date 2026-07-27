import { beforeEach, describe, expect, it } from 'bun:test'
import { Broker } from './broker'
import { DefaultClient } from './client'
import { Message } from './message'

describe('Broker', () => {
  let broker: Broker

  beforeEach(() => {
    broker = new Broker()
  })

  it('starts with zero clients', () => {
    expect(broker.totalClients()).toBe(0)
    expect(broker.clients().size).toBe(0)
  })

  it('register adds a client', () => {
    const client = new DefaultClient('client1')
    broker.register(client)

    expect(broker.totalClients()).toBe(1)
    expect(broker.clients().has('client1')).toBe(true)
  })

  it('register replaces existing client with same id', () => {
    const client1 = new DefaultClient('client1')
    client1.set('data', 'old')
    broker.register(client1)

    const client2 = new DefaultClient('client1')
    client2.set('data', 'new')
    broker.register(client2)

    expect(broker.totalClients()).toBe(1)
    const retrieved = broker.clientById('client1')
    expect(retrieved.get('data')).toBe('new')
  })

  it('unregister removes and discards a client', () => {
    const client = new DefaultClient('client1')
    broker.register(client)
    expect(client.isDiscarded()).toBe(false)

    broker.unregister('client1')
    expect(broker.totalClients()).toBe(0)
    expect(client.isDiscarded()).toBe(true)
  })

  it('unregister is no-op for unknown id', () => {
    broker.unregister('nonexistent') // should not throw
    expect(broker.totalClients()).toBe(0)
  })

  it('clientById returns the correct client', () => {
    const client = new DefaultClient('client1')
    broker.register(client)

    const retrieved = broker.clientById('client1')
    expect(retrieved.id()).toBe('client1')
  })

  it('clientById throws for unknown id', () => {
    expect(() => broker.clientById('nonexistent')).toThrow(
      'no client associated with connection id "nonexistent"',
    )
  })

  it('totalClients returns accurate count', () => {
    expect(broker.totalClients()).toBe(0)

    broker.register(new DefaultClient('a'))
    expect(broker.totalClients()).toBe(1)

    broker.register(new DefaultClient('b'))
    broker.register(new DefaultClient('c'))
    expect(broker.totalClients()).toBe(3)

    broker.unregister('a')
    expect(broker.totalClients()).toBe(2)
  })

  it('chunkedClients splits clients into chunks', () => {
    for (let i = 0; i < 5; i++) {
      broker.register(new DefaultClient(`client${i}`))
    }

    const chunks = broker.chunkedClients(2)
    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toHaveLength(2)
    expect(chunks[1]).toHaveLength(2)
    expect(chunks[2]).toHaveLength(1)
  })

  it('broadcast sends to all subscribed clients', () => {
    const msg = new Message('test', new TextEncoder().encode('payload'))
    const received: string[] = []

    const client1 = new DefaultClient('c1')
    client1.subscribe('topic1')
    client1.onMessage = () => {
      received.push('c1')
    }

    const client2 = new DefaultClient('c2')
    client2.subscribe('topic1')
    client2.onMessage = () => {
      received.push('c2')
    }

    const client3 = new DefaultClient('c3')
    client3.subscribe('topic2')
    client3.onMessage = () => {
      received.push('c3')
    }

    broker.register(client1)
    broker.register(client2)
    broker.register(client3)

    broker.broadcast('topic1', msg)
    expect(received.sort()).toEqual(['c1', 'c2'])
  })

  it('broadcast with empty topic sends to all', () => {
    const msg = new Message('test', new TextEncoder().encode('payload'))
    let count = 0

    for (let i = 0; i < 3; i++) {
      const client = new DefaultClient(`c${i}`)
      client.onMessage = () => {
        count++
      }
      broker.register(client)
    }

    broker.broadcast('', msg)
    expect(count).toBe(3)
  })

  it('broadcastTo sends to specific client ids', () => {
    const msg = new Message('test', new TextEncoder().encode('payload'))
    const received: string[] = []

    for (let i = 0; i < 5; i++) {
      const client = new DefaultClient(`c${i}`)
      client.onMessage = () => {
        received.push(`c${i}`)
      }
      broker.register(client)
    }

    broker.broadcastTo(['c1', 'c3'], msg)
    expect(received.sort()).toEqual(['c1', 'c3'])
  })

  it('broadcastTo silently skips unknown ids', () => {
    const msg = new Message('test', new TextEncoder().encode('payload'))
    let count = 0

    const client = new DefaultClient('known')
    client.onMessage = () => {
      count++
    }
    broker.register(client)

    // Should not throw
    broker.broadcastTo(['known', 'unknown'], msg)
    expect(count).toBe(1)
  })

  it('broadcast skips discarded clients', () => {
    const msg = new Message('test', new TextEncoder().encode('payload'))
    let count = 0

    const client = new DefaultClient('c1')
    client.subscribe('topic')
    client.onMessage = () => {
      count++
    }
    broker.register(client)

    broker.unregister('c1') // discards it
    broker.broadcast('topic', msg)
    expect(count).toBe(0)
  })
})
