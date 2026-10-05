import { describe, expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { MemoryDatabaseAdapter } from '~/core/db-memory-adapter'
import {
  type MigrationLockClient,
  type MigrationLockPool,
  withPostgresMigrationLock,
} from '~/core/migration-lock'
import { MigrationRunner } from '~/core/migrations_runner'

// @new-code-test positive src/core/migration-lock.ts
// @new-code-test negative src/core/migration-lock.ts
// @new-code-test positive src/core/migrations_runner.ts
// @new-code-test negative src/core/migrations_runner.ts

function lockClient(
  methods: Pick<MigrationLockClient, 'query' | 'release'>,
): MigrationLockClient & EventEmitter {
  return Object.assign(new EventEmitter(), methods)
}

function simulatedPool(events: string[]): MigrationLockPool {
  let tail = Promise.resolve()
  return {
    async connect() {
      let unlock: (() => void) | undefined
      return lockClient({
        async query(sql: string) {
          if (sql.includes('pg_advisory_lock(')) {
            const previous = tail
            tail = new Promise<void>((resolve) => {
              unlock = resolve
            })
            await previous
            events.push('lock')
          } else if (sql.includes('pg_advisory_unlock(')) {
            events.push('unlock')
            unlock?.()
          }
        },
        release() {
          events.push('release')
        },
      })
    },
  }
}

describe('migration lock with the in-memory database', () => {
  test('two concurrent runners apply a migration once after re-reading the ledger', async () => {
    const db = new MemoryDatabaseAdapter()
    const events: string[] = []
    const pool = simulatedPool(events)
    let applies = 0
    const raw = async (sql: string) => {
      if (sql.includes('CREATE TABLE IF NOT EXISTS _migrations')) {
        await db.createTable('_migrations')
      } else if (sql.includes('INSERT INTO _migrations')) {
        const name = /VALUES \('([^']+)'/.exec(sql)?.[1]
        if (!name) throw new Error('Migration name missing')
        await db.insert('_migrations', { name })
      }
    }
    const startReplica = () =>
      withPostgresMigrationLock(pool, async () => {
        const runner = new MigrationRunner(db, { raw })
        runner.register({
          name: '2000000000_shared',
          up: async () => {
            applies++
            await Bun.sleep(10)
            await db.createTable('shared_feature')
          },
        })
        return runner.run(new AbortController().signal)
      })

    const applied = await Promise.all([startReplica(), startReplica()])
    expect(applied).toEqual([1, 0])
    expect(applies).toBe(1)
    expect(await db.hasTable('shared_feature')).toBe(true)
    expect(await db.count('_migrations')).toBe(1)
    expect(events.filter((event) => event !== 'release')).toEqual([
      'lock',
      'unlock',
      'lock',
      'unlock',
    ])
    expect(events.filter((event) => event === 'release')).toHaveLength(2)
  })

  test('releases the lock when migration work fails', async () => {
    const events: string[] = []
    await expect(
      withPostgresMigrationLock(simulatedPool(events), async () => {
        throw new Error('migration failed')
      }),
    ).rejects.toThrow('migration failed')
    expect(events).toEqual(['lock', 'unlock', 'release'])
  })

  test('does not run migrations or unlock when lock acquisition fails', async () => {
    const queries: string[] = []
    let released: boolean | undefined
    let ran = false
    const pool: MigrationLockPool = {
      async connect() {
        return lockClient({
          async query(sql) {
            queries.push(sql)
            throw new Error('database unavailable')
          },
          release(destroy) {
            released = destroy
          },
        })
      },
    }
    await expect(
      withPostgresMigrationLock(pool, async () => {
        ran = true
      }),
    ).rejects.toThrow('database unavailable')
    expect(ran).toBe(false)
    expect(queries).toEqual(['SELECT pg_advisory_lock(732031, 1)'])
    expect(released).toBe(true)
  })

  test('destroys the connection if advisory unlock fails', async () => {
    let released: boolean | undefined
    const pool: MigrationLockPool = {
      async connect() {
        return lockClient({
          async query(sql) {
            if (sql.includes('pg_advisory_unlock')) throw new Error('unlock failed')
          },
          release(destroy) {
            released = destroy
          },
        })
      },
    }
    await expect(withPostgresMigrationLock(pool, async () => 1)).rejects.toThrow('unlock failed')
    expect(released).toBe(true)
  })

  test('preserves both migration and unlock failures', async () => {
    let destroyed: boolean | undefined
    const pool: MigrationLockPool = {
      async connect() {
        return lockClient({
          async query(sql) {
            if (sql.includes('pg_advisory_unlock')) throw new Error('unlock failed')
          },
          release(destroy) {
            destroyed = destroy
          },
        })
      },
    }
    try {
      await withPostgresMigrationLock(pool, async () => {
        throw new Error('migration failed')
      })
      throw new Error('expected migration lock failure')
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError)
      expect((error as AggregateError).message).toBe('Migration and lock release failed')
      expect((error as AggregateError).errors.map((entry: Error) => entry.message)).toEqual([
        'migration failed',
        'unlock failed',
      ])
    }
    expect(destroyed).toBe(true)
  })

  test('reuses a healthy connection after a successful migration', async () => {
    let destroyed: boolean | undefined
    const pool: MigrationLockPool = {
      async connect() {
        return lockClient({
          async query() {},
          release(destroy) {
            destroyed = destroy
          },
        })
      },
    }
    expect(await withPostgresMigrationLock(pool, async () => 'applied')).toBe('applied')
    expect(destroyed).toBe(false)
  })

  test('reuses a healthy connection when migration work fails after locking', async () => {
    let destroyed: boolean | undefined
    const pool: MigrationLockPool = {
      async connect() {
        return lockClient({
          async query() {},
          release(destroy) {
            destroyed = destroy
          },
        })
      },
    }
    await expect(
      withPostgresMigrationLock(pool, async () => {
        throw new Error('migration failed')
      }),
    ).rejects.toThrow('migration failed')
    expect(destroyed).toBe(false)
  })

  test('aborts migration work and destroys the client when the lock connection fails', async () => {
    const events: string[] = []
    const client = lockClient({
      async query(sql) {
        events.push(sql)
      },
      release(destroy) {
        events.push(`release:${destroy}`)
      },
    })
    let workStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      workStarted = resolve
    })
    const work = withPostgresMigrationLock(
      {
        async connect() {
          return client
        },
      },
      async (signal) => {
        workStarted?.()
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true })
        })
        signal.throwIfAborted()
        events.push('continued')
      },
    )
    await started
    client.emit('error', new Error('lock connection lost'))
    await expect(work).rejects.toThrow('lock connection lost')
    expect(events).toEqual(['SELECT pg_advisory_lock(732031, 1)', 'release:true'])
  })

  test('aborts migration work when PostgreSQL ends the lock session', async () => {
    const client = lockClient({ async query() {}, release() {} })
    let workStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      workStarted = resolve
    })
    const work = withPostgresMigrationLock(
      {
        async connect() {
          return client
        },
      },
      async (signal) => {
        workStarted?.()
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true })
        })
        signal.throwIfAborted()
      },
    )
    await started
    client.emit('end')
    await expect(work).rejects.toThrow('Migration lock connection ended')
  })

  test('does not record a migration if its signal aborts during SQL execution', async () => {
    const db = new MemoryDatabaseAdapter()
    const controller = new AbortController()
    const raw = async (sql: string) => {
      if (sql.includes('CREATE TABLE IF NOT EXISTS _migrations')) {
        await db.createTable('_migrations')
      } else if (sql.includes('CREATE TABLE shared_feature')) {
        await db.createTable('shared_feature')
        controller.abort(new Error('migration lock lost'))
      } else if (sql.includes('INSERT INTO _migrations')) {
        throw new Error('aborted migration must not be recorded')
      }
    }
    const runner = new MigrationRunner(db, { raw })
    runner.register({
      name: '2000000000_shared',
      up: async (migration) => {
        await migration.raw('CREATE TABLE shared_feature')
      },
    })
    await expect(runner.run(controller.signal)).rejects.toThrow('migration lock lost')
    expect(await db.count('_migrations')).toBe(0)
  })
})
