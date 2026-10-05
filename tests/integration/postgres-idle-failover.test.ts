import { expect, test } from 'bun:test'
import { sql } from 'kysely'
import { Pool } from 'pg'
import { createDatabase } from '~/core/db'
import { PostgresDatabase } from '~/core/db-postgres'
import { requirePostgres } from '../harness'

// @new-code-test positive src/core/db-postgres.ts
// @new-code-test negative src/core/db-postgres.ts
// @new-code-test positive src/core/db.ts
// @new-code-test negative src/core/db.ts

test('database pools recover after their own idle connection is terminated', async () => {
  const loggedErrors: string[] = []
  const originalConsoleError = console.error
  console.error = (...args: unknown[]) => {
    loggedErrors.push(args.map(String).join(' '))
    originalConsoleError(...args)
  }
  const connectionString = requirePostgres()
  const admin = new Pool({ connectionString, max: 1 })
  const wrapped = new PostgresDatabase({
    postgresUrl: connectionString,
    readReplicaUrl: connectionString,
    runtimeRole: '',
  })
  let basic: Awaited<ReturnType<typeof createDatabase>> | undefined
  try {
    await wrapped.connect()
    basic = await createDatabase({ postgresUrl: connectionString })

    const writer = wrapped.getPool()
    const client = await writer.connect()
    const writerPid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
      .rows[0]?.pid
    client.release()
    expect(writerPid).toBeNumber()
    await admin.query('SELECT pg_terminate_backend($1)', [writerPid])

    const readerPid = (
      await sql<{ pid: number }>`SELECT pg_backend_pid() AS pid`.execute(wrapped.getReader())
    ).rows[0]?.pid
    expect(readerPid).toBeNumber()
    await admin.query('SELECT pg_terminate_backend($1)', [readerPid])

    const basicPid = (await sql<{ pid: number }>`SELECT pg_backend_pid() AS pid`.execute(basic.db))
      .rows[0]?.pid
    expect(basicPid).toBeNumber()
    await admin.query('SELECT pg_terminate_backend($1)', [basicPid])

    await Bun.sleep(100)
    expect(loggedErrors.some((message) => message.includes('idle writer connection failed'))).toBe(
      true,
    )
    expect(loggedErrors.some((message) => message.includes('idle reader connection failed'))).toBe(
      true,
    )
    expect(loggedErrors.some((message) => message.includes('idle connection failed'))).toBe(true)
    expect((await writer.query('SELECT 1 AS ok')).rows[0]?.ok).toBe(1)
    expect(
      (await sql<{ ok: number }>`SELECT 1 AS ok`.execute(wrapped.getReader())).rows[0]?.ok,
    ).toBe(1)
    expect((await sql<{ ok: number }>`SELECT 1 AS ok`.execute(basic.db)).rows[0]?.ok).toBe(1)
  } finally {
    console.error = originalConsoleError
    await basic?.close()
    await wrapped.close()
    await admin.end()
  }
})
