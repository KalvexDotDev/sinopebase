import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Pool } from 'pg'
import { type MigrationLockPool, withPostgresMigrationLock } from '~/core/migration-lock'
import { requirePostgres } from '../harness'

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
    const pid = await lockPid
    const terminator = await second.query('SELECT pg_terminate_backend($1) AS terminated', [pid])
    expect(terminator.rows[0]?.terminated).toBe(true)
    await expect(work).rejects.toThrow()
  })
})
