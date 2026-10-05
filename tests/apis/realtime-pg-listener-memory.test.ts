import { afterEach, describe, expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import type { Pool } from 'pg'
import type { PostgresChange, PostgrestChangePublisher } from '~/apis/realtime'
import { attachRealtimeTriggers, PgRealtimeListener } from '~/apis/realtime-pg-listener'

// @new-code-test positive src/apis/realtime-pg-listener.ts
// @new-code-test negative src/apis/realtime-pg-listener.ts

class FakeClient extends EventEmitter {
  readonly queries: string[] = []
  readonly releases: boolean[] = []
  failListen = false
  failHeartbeat = false

  async query(sql: string): Promise<{ rows: unknown[] }> {
    this.queries.push(sql)
    if (this.failListen && sql.startsWith('LISTEN')) throw new Error('listen failed')
    if (this.failHeartbeat && sql === 'SELECT 1') throw new Error('heartbeat failed')
    return { rows: [] }
  }

  release(destroy = false): void {
    this.releases.push(destroy)
  }
}

function fakePool(clients: FakeClient[]): Pool {
  return {
    connect: async () => {
      const client = clients.shift()
      if (!client) throw new Error('no client available')
      return client
    },
  } as unknown as Pool
}

const listeners: PgRealtimeListener[] = []
afterEach(async () => {
  await Promise.all(listeners.splice(0).map((listener) => listener.stop()))
})

describe('PostgreSQL listener with simulated connections', () => {
  test('forwards committed row events and skips self-originated notifications', async () => {
    const client = new FakeClient()
    const changes: PostgresChange[] = []
    const hub: PostgrestChangePublisher = {
      async publishPostgresChange(change) {
        changes.push(change)
      },
      async preparePostgresChange() {
        return { deliver() {} }
      },
    }
    const listener = new PgRealtimeListener({ pool: fakePool([client]), hub, processId: 'pod-a' })
    listeners.push(listener)
    await listener.start()
    expect(listener.isConnected()).toBe(true)
    expect(client.queries.some((sql) => sql.startsWith('LISTEN'))).toBe(true)

    const payload = {
      schema: 'public',
      table: 'todos',
      event: 'INSERT',
      new: { id: 'one' },
      old: {},
    }
    client.emit('notification', { channel: 'sinopebase_changes', payload: JSON.stringify(payload) })
    client.emit('notification', {
      channel: 'sinopebase_changes',
      payload: JSON.stringify({ ...payload, process_id: 'pod-a' }),
    })
    await Bun.sleep(0)
    expect(changes).toEqual([
      { schema: 'public', table: 'todos', event: 'INSERT', new: { id: 'one' }, old: {} },
    ])

    await listener.stop()
    expect(listener.isConnected()).toBe(false)
    expect(client.releases).toEqual([true])
  })

  test('failed LISTEN rejects startup and releases the broken connection', async () => {
    const client = new FakeClient()
    client.failListen = true
    const listener = new PgRealtimeListener({
      pool: fakePool([client]),
      hub: {
        async publishPostgresChange() {},
        async preparePostgresChange() {
          return { deliver() {} }
        },
      },
      processId: 'pod-a',
    })
    listeners.push(listener)
    await expect(listener.start()).rejects.toThrow('listen failed')
    expect(listener.isConnected()).toBe(false)
    expect(client.releases).toEqual([true])
  })

  test('drops readiness on a connection error and reconnects', async () => {
    const first = new FakeClient()
    const second = new FakeClient()
    const listener = new PgRealtimeListener({
      pool: fakePool([first, second]),
      hub: {
        async publishPostgresChange() {},
        async preparePostgresChange() {
          return { deliver() {} }
        },
      },
      processId: 'pod-a',
    })
    listeners.push(listener)
    await listener.start()
    first.emit('error', new Error('failover'))
    expect(listener.isConnected()).toBe(false)
    expect(first.releases).toEqual([true])
    await Bun.sleep(1100)
    expect(listener.isConnected()).toBe(true)
    expect(second.queries.some((sql) => sql.startsWith('LISTEN'))).toBe(true)
  })

  test('heartbeat query failure drops readiness and schedules reconnection', async () => {
    const first = new FakeClient()
    first.failHeartbeat = true
    const second = new FakeClient()
    const logs: string[] = []
    const listener = new PgRealtimeListener({
      pool: fakePool([first, second]),
      hub: {
        async publishPostgresChange() {},
        async preparePostgresChange() {
          return { deliver() {} }
        },
      },
      processId: 'pod-a',
      heartbeatIntervalMs: 10,
      log(message) {
        logs.push(message)
      },
    })
    listeners.push(listener)
    await listener.start()
    await Bun.sleep(50)
    expect(listener.isConnected()).toBe(false)
    expect(logs.some((message) => message.includes('Heartbeat failed'))).toBe(true)
    expect(first.releases).toEqual([true])
    await Bun.sleep(1050)
    expect(listener.isConnected()).toBe(true)
  })

  test('attaches triggers with quoted catalog identifiers', async () => {
    const statements: string[] = []
    const pool = {
      async query(sql: string) {
        statements.push(sql)
        if (sql.includes('information_schema.tables'))
          return { rows: [{ table_name: 'task"notes' }] }
        if (sql.includes('FROM pg_trigger')) return { rowCount: 0 }
        return { rowCount: 0 }
      },
    } as unknown as Pool
    await attachRealtimeTriggers(pool, undefined, true)
    expect(statements.some((sql) => sql.includes('ON public."task""notes"'))).toBe(true)
    expect(
      statements.some((sql) => sql.includes('CREATE TRIGGER "sinopebase_notify_task""notes"')),
    ).toBe(true)
  })

  test('does not attach a duplicate trigger', async () => {
    const statements: string[] = []
    const pool = {
      async query(sql: string) {
        statements.push(sql)
        if (sql.includes('information_schema.tables')) return { rows: [{ table_name: 'todos' }] }
        return { rowCount: 1 }
      },
    } as unknown as Pool
    await attachRealtimeTriggers(pool, undefined, true)
    expect(statements.some((sql) => sql.includes('CREATE TRIGGER'))).toBe(false)
  })

  test('strict trigger attachment fails startup when a table cannot be instrumented', async () => {
    const pool = {
      async query(sql: string) {
        if (sql.includes('information_schema.tables')) return { rows: [{ table_name: 'todos' }] }
        if (sql.includes('FROM pg_trigger')) return { rowCount: 0 }
        throw new Error('permission denied')
      },
    } as unknown as Pool
    await expect(attachRealtimeTriggers(pool, undefined, true)).rejects.toThrow('permission denied')
  })
})
