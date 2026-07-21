import { describe, it, expect } from 'bun:test'
import { normalizeTableName } from '~/core/collection_record_table_sync.ts'

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
