import { describe, it, expect } from 'bun:test'
import { SelectField, FieldTypeSelect } from '~/core/field_select.ts'
import { CreateField } from '~/core/field.ts'

describe('SelectField', () => {
  it('has type "select"', () => {
    const f = new SelectField()
    expect(f.type).toBe(FieldTypeSelect)
  })

  it('can be created via factory', () => {
    const f = CreateField('select')
    expect(f).toBeInstanceOf(SelectField)
  })

  it('defaults to single select', () => {
    const f = new SelectField()
    expect(f.maxSelect).toBe(0)
    expect(f.isMultiple).toBe(false)
  })

  describe('columnType', () => {
    it('returns TEXT for single select', () => {
      const f = new SelectField()
      expect(f.columnType).toBe("TEXT DEFAULT '' NOT NULL")
    })

    it('returns JSON for multi select', () => {
      const f = new SelectField()
      f.maxSelect = 3
      expect(f.columnType).toBe("JSON DEFAULT '[]' NOT NULL")
    })
  })

  describe('settingsSchema', () => {
    it('returns string with enum for single select', () => {
      const f = new SelectField()
      f.values = ['a', 'b', 'c']
      const schema = f.settingsSchema
      expect(schema['type']).toBe('string')
      expect(schema['enum']).toEqual(['a', 'b', 'c'])
    })

    it('returns array with enum for multi select', () => {
      const f = new SelectField()
      f.values = ['a', 'b', 'c']
      f.maxSelect = 3
      const schema = f.settingsSchema
      expect(schema['type']).toBe('array')
      expect((schema as Record<string, unknown>)['items']).toEqual({ type: 'string', enum: ['a', 'b', 'c'] })
      expect(schema['maxItems']).toBe(3)
    })
  })

  describe('normalizeValue', () => {
    it('returns last value for single select', () => {
      const f = new SelectField()
      expect(f.normalizeValue(['x', 'y', 'z'])).toBe('z')
    })

    it('returns empty string for empty single select', () => {
      const f = new SelectField()
      expect(f.normalizeValue([])).toBe('')
    })

    it('returns array for multi select', () => {
      const f = new SelectField()
      f.maxSelect = 3
      expect(f.normalizeValue(['a', 'b'])).toEqual(['a', 'b'])
    })
  })

  describe('validateValue', () => {
    it('returns null for empty when not required', () => {
      const f = new SelectField()
      expect(f.validateValue([])).toBeNull()
    })

    it('returns error for empty when required', () => {
      const f = new SelectField()
      f.required = true
      expect(f.validateValue([])).not.toBeNull()
    })

    it('validates against maxSelect', () => {
      const f = new SelectField()
      f.values = ['a', 'b', 'c']
      f.maxSelect = 2
      expect(f.validateValue(['a', 'b', 'c'])).not.toBeNull()
    })

    it('validates against allowed values', () => {
      const f = new SelectField()
      f.values = ['a', 'b']
      expect(f.validateValue(['c'])).not.toBeNull()
    })

    it('passes for valid selection', () => {
      const f = new SelectField()
      f.values = ['a', 'b', 'c']
      f.maxSelect = 2
      expect(f.validateValue(['a', 'b'])).toBeNull()
    })
  })

  describe('validateSettings', () => {
    it('requires at least one value', () => {
      const f = new SelectField()
      f.id = 'fld1'
      f.name = 'select'
      const errors = f.validateSettings()
      expect(errors.some((e) => e.includes('values'))).toBe(true)
    })

    it('validates maxSelect range', () => {
      const f = new SelectField()
      f.id = 'fld1'
      f.name = 'select'
      f.values = ['a', 'b']
      f.maxSelect = 10
      const errors = f.validateSettings()
      expect(errors.some((e) => e.includes('maxSelect'))).toBe(true)
    })
  })
})
