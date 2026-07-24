import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { IDatabase } from './db-interface'
import { hasDatabaseSchemaCapability } from './db-interface'
import { PostgresDatabase } from './db-postgres'

const postgresUrl = process.env['TEST_POSTGRES_URL'] ?? process.env['POSTGRES_URL']
const describePostgres = postgresUrl ? describe : describe.skip
const table = `sinopebase_db_contract_${process.pid}`

describePostgres('PostgresDatabase canonical database contract', () => {
  let concrete: PostgresDatabase
  let db: IDatabase

  beforeAll(async () => {
    concrete = new PostgresDatabase({ postgresUrl: postgresUrl! })
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
      id: 'one', task: 'first', is_complete: false, user_id: 'tenant-one',
    })
    const upserted = await db.upsert(table, {
      id: 'one', task: 'updated', is_complete: false, user_id: 'tenant-one',
    })
    expect(upserted['task']).toBe('updated')
    expect(await db.count(table)).toBe(1)

    const updated = await db.update(
      table,
      [{ column: 'id', operator: 'eq', value: 'one' }],
      { is_complete: true },
    )
    expect(updated[0]?.['is_complete']).toBe(true)

    const deleted = await db.delete(
      table,
      [{ column: 'id', operator: 'eq', value: 'one' }],
    )
    expect(deleted.map((row) => row['id'])).toEqual(['one'])
  })

  it('supports options-object filters, structured OR groups, and pagination', async () => {
    await db.insert(table, {
      id: 'a', task: 'open', is_complete: false, user_id: 'tenant-one',
    })
    await db.insert(table, {
      id: 'b', task: 'closed', is_complete: true, user_id: 'tenant-one',
    })
    await db.insert(table, {
      id: 'c', task: 'open', is_complete: false, user_id: 'tenant-two',
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

    expect(rows.map((row) => row['id'])).toEqual(['b'])
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
    expect(rows.map((row) => row['id'])).toEqual(['b'])
  })

  it('rejects unknown filters and does not claim arbitrary schema mutation support', async () => {
    await expect(db.select(table, {
      filters: [{ column: 'id', operator: 'unsupported', value: 'a' }],
    })).rejects.toThrow('Unsupported filter operator')
    expect(hasDatabaseSchemaCapability(db)).toBe(false)
  })
})
