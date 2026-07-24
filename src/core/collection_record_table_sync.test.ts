import { describe, it, expect } from 'bun:test'
import {
  normalizeTableName,
  syncRecordTableSchema,
} from '~/core/collection_record_table_sync.ts'
import type { DatabaseSchemaCapability } from '~/core/db-interface.ts'
import { MemoryDatabaseAdapter } from '~/core/db-memory-adapter.ts'
import { Collection } from '~/core/collection_model.ts'

class SchemaMemoryDatabase extends MemoryDatabaseAdapter implements DatabaseSchemaCapability {
  readonly operations: string[] = []

  async addColumn(table: string, column: string, columnType: string): Promise<void> {
    this.operations.push(`add:${table}:${column}:${columnType}`)
  }

  async dropColumn(table: string, column: string): Promise<void> {
    this.operations.push(`drop:${table}:${column}`)
  }

  async renameColumn(table: string, oldName: string, newName: string): Promise<void> {
    this.operations.push(`rename:${table}:${oldName}:${newName}`)
  }
}

function collectionWithTextField(name: string): Collection {
  const collection = Collection.createBase(name)
  collection.fields.add({
    id: 'title-field',
    name: 'title',
    type: 'text',
    system: false,
    hidden: false,
    columnType: 'TEXT DEFAULT NULL',
    settingsSchema: {},
  })
  return collection
}

describe('normalizeTableName', () => {
  it('lowercases the name', () => {
    expect(normalizeTableName('MyTable')).toBe('mytable')
  })

  it('replaces special characters', () => {
    expect(normalizeTableName('my-table!')).toBe('my_table_')
  })

  it('preserves valid characters', () => {
    expect(normalizeTableName('articles_2024')).toBe('articles_2024')
  })
})

describe('syncRecordTableSchema capabilities', () => {
  it('uses an explicit schema capability and FieldsList.all()', async () => {
    const db = new SchemaMemoryDatabase()
    await syncRecordTableSchema(db, collectionWithTextField('articles'), null)

    expect(await db.hasTable('articles')).toBe(true)
    expect(db.operations).toEqual([
      'add:articles:title:TEXT DEFAULT NULL',
    ])
  })

  it('fails before mutation when the database has only CRUD capabilities', async () => {
    const db = new MemoryDatabaseAdapter()
    await expect(
      syncRecordTableSchema(db, collectionWithTextField('articles'), null),
    ).rejects.toThrow('does not support record-table schema mutations')
    expect(await db.hasTable('articles')).toBe(false)
  })

  it('fails closed for unsupported index synchronization', async () => {
    const db = new SchemaMemoryDatabase()
    const collection = collectionWithTextField('articles')
    collection.indexes = ['CREATE INDEX idx_articles_title ON articles (title)']

    await expect(syncRecordTableSchema(db, collection, null)).rejects.toThrow(
      'does not support record-table index synchronization',
    )
    expect(await db.hasTable('articles')).toBe(false)
  })
})
