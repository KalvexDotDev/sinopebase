import { describe, expect, it } from 'bun:test'
import { Collection } from '~/core/collection_model.ts'
import { CollectionValidator, isValidCollectionName } from '~/core/collection_validate.ts'
import type { Filter } from '~/core/db-interface'
import { MemoryDatabase } from '~/core/db-memory.ts'

// Create an adapter to make MemoryDatabase compatible with IDatabase
function createTestDb(): import('~/core/db-interface.ts').IDatabase {
  const mem = new MemoryDatabase()
  // Wrap MemoryDatabase to match IDatabase interface
  return {
    createTable: async (table: string) => {
      mem.createTable(table)
    },
    hasTable: async (table: string) => mem.hasTable(table),
    dropTable: async (table: string) => {
      mem.dropTable(table)
    },
    insert: async (table: string, record: Record<string, unknown>) => {
      const rows = mem.insert(table, [record])
      return rows[0] ?? record
    },
    upsert: async (table: string, record: Record<string, unknown>) => {
      const rows = mem.upsert(table, [record])
      return rows[0] ?? record
    },
    select: async (
      table: string,
      options: { filters: { column: string; operator: string; value: unknown }[] },
    ) => {
      const result = mem.select(table, { filters: options.filters as Filter[] })
      return result.rows
    },
    update: async (
      table: string,
      filters: { column: string; operator: string; value: unknown }[],
      data: Record<string, unknown>,
    ) => {
      const result = mem.update(table, filters as Filter[], data)
      return result
    },
    delete: async (
      table: string,
      filters: { column: string; operator: string; value: unknown }[],
    ) => {
      const result = mem.delete(table, filters as Filter[])
      return result
    },
    count: async (
      table: string,
      filters?: { column: string; operator: string; value: unknown }[],
    ) => {
      return mem.count(table, (filters as Filter[]) ?? [])
    },
  }
}

describe('isValidCollectionName', () => {
  it('accepts valid names', () => {
    expect(isValidCollectionName('articles')).toBe(true)
    expect(isValidCollectionName('my_collection')).toBe(true)
    expect(isValidCollectionName('a123')).toBe(true)
  })

  it('rejects invalid names', () => {
    expect(isValidCollectionName('')).toBe(false)
    expect(isValidCollectionName('123abc')).toBe(false) // starts with digit
    expect(isValidCollectionName('no spaces')).toBe(false)
    expect(isValidCollectionName('special!chars')).toBe(false)
  })
})

describe('CollectionValidator', () => {
  it('passes for a valid base collection', async () => {
    const db = createTestDb()
    const c = Collection.createBase('articles')
    c.id = 'validid123'
    // Add the required id field
    c.fields.add({
      id: 'f_id',
      name: 'id',
      type: 'text',
      system: true,
      hidden: false,
      columnType: 'TEXT PRIMARY KEY DEFAULT ...',
      settingsSchema: { type: 'string' },
    })

    const validator = new CollectionValidator(c, null, db)
    const errors = await validator.validate()
    expect(errors.length).toBe(0)
  })

  it('rejects empty name', async () => {
    const db = createTestDb()
    const c = Collection.createBase('')
    const validator = new CollectionValidator(c, null, db)
    const errors = await validator.validate()
    expect(errors.some((e) => e.includes('name'))).toBe(true)
  })

  it('rejects invalid type', async () => {
    const db = createTestDb()
    const c = Collection.createBase('test')
    ;(c as Filter[]).type = 'invalid'
    const validator = new CollectionValidator(c, null, db)
    const errors = await validator.validate()
    expect(errors.some((e) => e.includes('type'))).toBe(true)
  })

  it('rejects reserved names', async () => {
    const db = createTestDb()
    const c = Collection.createBase('id') // 'id' is reserved
    c.id = 'col1'
    const validator = new CollectionValidator(c, null, db)
    const errors = await validator.validate()
    // 'id' as a collection name should be rejected
    expect(errors.some((e) => e.includes('name'))).toBe(true)
  })
})
