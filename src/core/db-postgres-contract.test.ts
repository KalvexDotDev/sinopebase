// @new-code-test positive src/core/db-postgres.ts
// @new-code-test negative src/core/db-postgres.ts
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { sql } from 'kysely'
import type { IDatabase } from './db-interface'
import { hasDatabaseSchemaCapability } from './db-interface'
import { PostgresDatabase } from './db-postgres'

const postgresUrl = process.env.TEST_POSTGRES_URL ?? process.env.POSTGRES_URL
const describePostgres = postgresUrl ? describe : describe.skip
const table = `sinopebase_db_contract_${process.pid}`

describePostgres('PostgresDatabase canonical database contract', () => {
  let concrete: PostgresDatabase
  let db: IDatabase

  beforeAll(async () => {
    if (!postgresUrl) throw new Error('TEST_POSTGRES_URL required')
    concrete = new PostgresDatabase({ postgresUrl })
    db = concrete
    await concrete.connect()
    await db.createTable(table)
  })

  afterAll(async () => {
    await db.dropTable(table)
    await Promise.all([concrete.close(), concrete.close()])
  })

  it('provides async single-record CRUD through IDatabase', async () => {
    await db.insert(table, {
      id: 'one',
      task: 'first',
      is_complete: false,
      user_id: 'tenant-one',
    })
    const upserted = await db.upsert(table, {
      id: 'one',
      task: 'updated',
      is_complete: false,
      user_id: 'tenant-one',
    })
    expect(upserted?.task).toBe('updated')
    expect(await db.count(table)).toBe(1)

    const updated = await db.update(table, [{ column: 'id', operator: 'eq', value: 'one' }], {
      is_complete: true,
    })
    expect(updated[0]?.is_complete).toBe(true)

    const deleted = await db.delete(table, [{ column: 'id', operator: 'eq', value: 'one' }])
    expect(deleted.map((row) => row.id)).toEqual(['one'])
  })

  it('upserts on a named conflict target and skips duplicates when asked', async () => {
    const keyed = `${table}_keyed`
    await sql`
      CREATE TABLE ${sql.table(keyed)} (id serial PRIMARY KEY, tenant text UNIQUE, phone text)
    `.execute(concrete.getWriter())
    try {
      const first = await db.upsert(keyed, { tenant: 't', phone: '1' }, { onConflict: ['tenant'] })
      const merged = await db.upsert(keyed, { tenant: 't', phone: '2' }, { onConflict: ['tenant'] })
      expect(merged).toEqual({ id: first?.id, tenant: 't', phone: '2' })
      const skipped = await db.upsert(
        keyed,
        { tenant: 't', phone: '3' },
        { onConflict: ['tenant'], ignoreDuplicates: true },
      )
      expect(skipped).toBeNull()
      expect(await db.select(keyed, { columns: ['phone'] })).toEqual([{ phone: '2' }])
      await expect(
        db.upsert(keyed, { tenant: 't' }, { onConflict: ['tenant"; drop'] }),
      ).rejects.toThrow('Invalid conflict column')
    } finally {
      await sql`DROP TABLE ${sql.table(keyed)}`.execute(concrete.getWriter())
    }
  })

  it('supports options-object filters, structured OR groups, and pagination', async () => {
    await db.insert(table, {
      id: 'a',
      task: 'open',
      is_complete: false,
      user_id: 'tenant-one',
    })
    await db.insert(table, {
      id: 'b',
      task: 'closed',
      is_complete: true,
      user_id: 'tenant-one',
    })
    await db.insert(table, {
      id: 'c',
      task: 'open',
      is_complete: false,
      user_id: 'tenant-two',
    })

    const rows = await db.select(table, {
      filters: [{ column: 'user_id', operator: 'eq', value: 'tenant-one' }],
      orFilters: [
        [{ column: 'task', operator: 'eq', value: 'open' }],
        [{ column: 'is_complete', operator: 'is', value: true }],
      ],
      order: [{ column: 'id', direction: 'desc' }],
      limit: 1,
      offset: 0,
    })

    expect(rows.map((row) => row.id)).toEqual(['b'])
    expect(await db.select(table, {})).toHaveLength(3)
  })

  it('retains the deprecated positional select overload for current callers', async () => {
    const rows = await concrete.select(
      table,
      [{ column: 'user_id', operator: 'eq', value: 'tenant-one' }],
      [{ column: 'id', direction: 'asc' }],
      1,
      1,
    )
    expect(rows.map((row) => row.id)).toEqual(['b'])
  })

  it('rejects unknown filters and does not claim arbitrary schema mutation support', async () => {
    await expect(
      db.select(table, {
        filters: [{ column: 'id', operator: 'unsupported', value: 'a' }],
      }),
    ).rejects.toThrow('Unsupported filter operator')
    expect(hasDatabaseSchemaCapability(db)).toBe(false)
  })
  it('projects explicit and empty column sets while preserving row order and cardinality', async () => {
    expect(await db.select(table, { columns: ['id'], order: [{ column: 'id' }] })).toEqual([
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
    ])
    expect(await db.select(table, { columns: [], order: [{ column: 'id' }] })).toEqual([{}, {}, {}])
    expect(
      await db.select(table, {
        columns: [],
        filters: [{ column: 'id', operator: 'eq', value: 'absent' }],
      }),
    ).toEqual([])
    expect((await db.select(table, {}))[0]).toHaveProperty('task')
  })

  it('writes JS arrays as the target column type, like PostgREST', async () => {
    const typed = `${table}_typed`
    await sql`
      CREATE TABLE ${sql.table(typed)} (
        id text PRIMARY KEY,
        facts jsonb NOT NULL CHECK (jsonb_typeof(facts) = 'array'),
        tags text[] NOT NULL
      )
    `.execute(concrete.getWriter())
    try {
      const inserted = await db.insert(typed, { id: 'x', facts: [], tags: ['a', 'b'] })
      expect(inserted.facts).toEqual([])
      expect(inserted.tags).toEqual(['a', 'b'])

      const upserted = await db.upsert(typed, { id: 'x', facts: [{ topic: 't' }], tags: [] })
      expect(upserted?.facts).toEqual([{ topic: 't' }])
      expect(upserted?.tags).toEqual([])

      const updated = await db.update(typed, [{ column: 'id', operator: 'eq', value: 'x' }], {
        facts: [1, 'two'],
        tags: ['c'],
      })
      expect(updated[0]?.facts).toEqual([1, 'two'])
      expect(updated[0]?.tags).toEqual(['c'])
    } finally {
      await sql`DROP TABLE ${sql.table(typed)}`.execute(concrete.getWriter())
    }
  })

  it('returns dates and timestamps as PostgREST prints them, so they round-trip as filters', async () => {
    const dated = `${table}_dated`
    await sql`
      CREATE TABLE ${sql.table(dated)} (id text PRIMARY KEY, at timestamptz NOT NULL, local timestamp NOT NULL, day date NOT NULL)
    `.execute(concrete.getWriter())
    try {
      await sql`
        INSERT INTO ${sql.table(dated)} VALUES ('x', '2026-09-27 22:18:09.497123+00', '2026-09-27 22:18:09.497123', '2026-09-27')
      `.execute(concrete.getWriter())
      // Internal callers (auth compares expiry to new Date()) keep getting Dates.
      const [internal] = await db.select(dated, {})
      expect(internal?.at).toBeInstanceOf(Date)

      const row = await concrete.withRequestContext({ role: 'service_role' }, async (scoped) => {
        const [selected] = await scoped.select(dated, {})
        return selected
      })
      expect(row).toMatchObject({
        at: '2026-09-27T22:18:09.497123+00:00',
        local: '2026-09-27T22:18:09.497123',
        day: '2026-09-27',
      })
      const guarded = await concrete.withRequestContext({ role: 'service_role' }, (scoped) =>
        scoped.update(
          dated,
          [
            { column: 'id', operator: 'eq', value: 'x' },
            { column: 'at', operator: 'eq', value: row?.at },
          ],
          { day: '2026-09-28' },
        ),
      )
      expect(guarded).toHaveLength(1)
    } finally {
      await sql`DROP TABLE ${sql.table(dated)}`.execute(concrete.getWriter())
    }
  })
})
