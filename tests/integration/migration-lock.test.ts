import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { type MigrationLockPool, withPostgresMigrationLock } from '~/core/migration-lock'
import { createMigrationSession } from '~/core/migration-session'
import { requirePostgres } from '../harness'

// @new-code-test positive src/core/migration-session.ts
// @new-code-test negative src/core/migration-session.ts

describe('PostgreSQL migration advisory lock', () => {
  let first: Pool
  let second: Pool

  beforeAll(() => {
    const connectionString = requirePostgres()
    first = new Pool({ connectionString, max: 2 })
    second = new Pool({ connectionString, max: 2 })
  })

  afterAll(async () => {
    await Promise.all([first?.end(), second?.end()])
  })

  test('serializes migration work across independent pools', async () => {
    let active = 0
    let maxActive = 0
    const work = async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await Bun.sleep(50)
      active--
    }
    await Promise.all([
      withPostgresMigrationLock(first, work),
      withPostgresMigrationLock(second, work),
    ])
    expect(maxActive).toBe(1)
  })

  test('aborts when PostgreSQL terminates the connection holding the lock', async () => {
    let reportPid: ((pid: number) => void) | undefined
    const lockPid = new Promise<number>((resolve) => {
      reportPid = resolve
    })
    const pool: MigrationLockPool = {
      async connect() {
        const client = await first.connect()
        const result = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
        reportPid?.(result.rows[0]?.pid ?? 0)
        return client
      },
    }
    const work = withPostgresMigrationLock(pool, async (signal) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true })
      })
      signal.throwIfAborted()
    })
    const workOutcome = work.then(
      () => null,
      (error: unknown) => error,
    )
    const pid = await lockPid
    const terminator = await second.query('SELECT pg_terminate_backend($1) AS terminated', [pid])
    expect(terminator.rows[0]?.terminated).toBe(true)
    expect(await workOutcome).toBeInstanceOf(Error)
  })

  test('rolls back an in-flight migration statement when its lock backend dies', async () => {
    const table = `lock_loss_${randomUUID().replaceAll('-', '')}`
    let reportPid: ((pid: number) => void) | undefined
    const lockPid = new Promise<number>((resolve) => {
      reportPid = resolve
    })
    const pool: MigrationLockPool = {
      async connect() {
        const client = await first.connect()
        const result = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
        reportPid?.(result.rows[0]?.pid ?? 0)
        return client
      },
    }
    const work = withPostgresMigrationLock(pool, async (signal, client) => {
      const session = createMigrationSession(client, signal)
      await client.query('BEGIN')
      await session.sql.raw(`CREATE TABLE "${table}" (id integer)`)
      await session.sql.raw('SELECT pg_sleep(10)')
      await client.query('COMMIT')
    })
    const workOutcome = work.then(
      () => null,
      (error: unknown) => error,
    )
    const pid = await lockPid
    for (let attempt = 0; attempt < 50; attempt++) {
      const activity = await second.query<{ active: boolean }>(
        "SELECT state = 'active' AND query LIKE '%pg_sleep(10)%' AS active FROM pg_stat_activity WHERE pid = $1",
        [pid],
      )
      if (activity.rows[0]?.active) break
      await Bun.sleep(20)
    }
    const terminated = await second.query('SELECT pg_terminate_backend($1) AS terminated', [pid])
    expect(terminated.rows[0]?.terminated).toBe(true)
    expect(await workOutcome).toBeInstanceOf(Error)
    const tableCheck = await second.query<{ name: string | null }>(
      'SELECT to_regclass($1) AS name',
      [table],
    )
    expect(tableCheck.rows[0]?.name).toBeNull()
  })
})
