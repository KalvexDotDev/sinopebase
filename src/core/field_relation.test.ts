import { describe, it, expect } from 'bun:test'
import { RelationField, FieldTypeRelation } from '~/core/field_relation.ts'
import { CreateField } from '~/core/field.ts'

describe('RelationField', () => {
  it('has type "relation"', () => {
    const f = new RelationField()
    expect(f.type).toBe(FieldTypeRelation)
  })

  it('can be created via factory', () => {
    const f = CreateField('relation')
    expect(f).toBeInstanceOf(RelationField)
  })

  it('defaults to single relation', () => {
    const f = new RelationField()
    expect(f.isMultiple).toBe(false)
  })

  describe('columnType', () => {
    it('returns TEXT for single relation', () => {
      const f = new RelationField()
      expect(f.columnType).toBe("TEXT DEFAULT '' NOT NULL")
    })

    it('returns JSON for multi relation', () => {
      const f = new RelationField()
      f.maxSelect = 3
      expect(f.columnType).toBe("JSON DEFAULT '[]' NOT NULL")
    })
  })

  describe('normalizeValue', () => {
    it('returns last id for single relation', () => {
      const f = new RelationField()
      expect(f.normalizeValue(['id1', 'id2'])).toBe('id2')
    })

    it('returns empty string for empty single relation', () => {
      const f = new RelationField()
      expect(f.normalizeValue([])).toBe('')
    })

    it('returns array for multi relation', () => {
      const f = new RelationField()
      f.maxSelect = 3
      expect(f.normalizeValue(['id1', 'id2'])).toEqual(['id1', 'id2'])
    })
  })

  describe('validateValue', () => {
    it('returns null for empty when not required', () => {
      const f = new RelationField()
      expect(f.validateValue([])).toBeNull()
    })

    it('returns error for empty when required', () => {
      const f = new RelationField()
      f.required = true
      expect(f.validateValue([])).not.toBeNull()
    })

    it('validates minSelect', () => {
      const f = new RelationField()
      f.minSelect = 2
      expect(f.validateValue(['id1'])).not.toBeNull()
    })

    it('validates maxSelect', () => {
      const f = new RelationField()
      f.maxSelect = 2
      expect(f.validateValue(['id1', 'id2', 'id3'])).not.toBeNull()
    })

    it('passes for valid selection', () => {
      const f = new RelationField()
      expect(f.validateValue(['id1'])).toBeNull()
    })
  })

  describe('validateSettings', () => {
    it('requires collectionId', () => {
      const f = new RelationField()
      f.id = 'fld1'
      f.name = 'rel'
      const errors = f.validateSettings()
      expect(errors.some((e) => e.includes('collectionId'))).toBe(true)
    })

    it('validates maxSelect >= minSelect', () => {
      const f = new RelationField()
      f.id = 'fld1'
      f.name = 'rel'
      f.collectionId = 'col1'
      f.minSelect = 3
      f.maxSelect = 1
      const errors = f.validateSettings()
      expect(errors.some((e) => e.includes('maxSelect'))).toBe(true)
    })
  })
})
