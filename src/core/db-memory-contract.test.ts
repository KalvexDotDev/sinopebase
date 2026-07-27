import { describe, expect, it } from 'bun:test'
import type { IDatabase } from './db-interface'
import { hasDatabaseSchemaCapability } from './db-interface'
import { MemoryDatabaseAdapter } from './db-memory-adapter'

describe('MemoryDatabaseAdapter canonical database contract', () => {
  it('provides async single-record CRUD through IDatabase', async () => {
    const db: IDatabase = new MemoryDatabaseAdapter()
    await db.createTable('records')

    const inserted = await db.insert('records', {
      id: 'one',
      tenant: 'a',
      state: 'open',
      rank: 1,
      enabled: true,
    })
    expect(inserted.id).toBe('one')

    const upserted = await db.upsert('records', {
      id: 'one',
      tenant: 'a',
      state: 'closed',
      rank: 2,
      enabled: false,
    })
    expect(upserted.state).toBe('closed')
    expect(await db.count('records')).toBe(1)

    const updated = await db.update('records', [{ column: 'id', operator: 'eq', value: 'one' }], {
      state: 'open',
    })
    expect(updated[0]?.state).toBe('open')

    const deleted = await db.delete('records', [{ column: 'id', operator: 'eq', value: 'one' }])
    expect(deleted.map((row) => row.id)).toEqual(['one'])
    expect(await db.count('records')).toBe(0)
  })

  it('supports optional filters, structured OR groups, ordering, and pagination', async () => {
    const db: IDatabase = new MemoryDatabaseAdapter()
    await db.createTable('records')
    await db.insert('records', { id: 'a', tenant: 'one', state: 'open', rank: 1 })
    await db.insert('records', { id: 'b', tenant: 'one', state: 'closed', rank: 2 })
    await db.insert('records', { id: 'c', tenant: 'two', state: 'open', rank: 3 })

    const selected = await db.select('records', {
      filters: [{ column: 'tenant', operator: 'eq', value: 'one' }],
      orFilters: [
        [{ column: 'state', operator: 'eq', value: 'open' }],
        [{ column: 'rank', operator: 'eq', value: 2 }],
      ],
      order: [{ column: 'rank', direction: 'desc' }],
      limit: 1,
      offset: 0,
    })

    expect(selected.map((row) => row.id)).toEqual(['b'])
    expect(await db.select('records', {})).toHaveLength(3)
  })

  it('supports typed is/in filters and rejects unknown operators', async () => {
    const db: IDatabase = new MemoryDatabaseAdapter()
    await db.createTable('records')
    await db.insert('records', { id: 'a', enabled: false, value: null })
    await db.insert('records', { id: 'b', enabled: true, value: 'present' })

    expect(
      await db.select('records', {
        filters: [{ column: 'enabled', operator: 'is', value: false }],
      }),
    ).toHaveLength(1)
    expect(
      await db.select('records', {
        filters: [{ column: 'value', operator: 'is', value: null }],
      }),
    ).toHaveLength(1)
    expect(
      await db.select('records', {
        filters: [{ column: 'id', operator: 'in', value: ['a', 'b'] }],
      }),
    ).toHaveLength(2)
    await expect(
      db.select('records', {
        filters: [{ column: 'id', operator: 'unsupported', value: 'a' }],
      }),
    ).rejects.toThrow('Unsupported filter operator')
  })

  it('does not claim unsafe record-table schema mutation support', () => {
    expect(hasDatabaseSchemaCapability(new MemoryDatabaseAdapter())).toBe(false)
  })
})
