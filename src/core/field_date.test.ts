import { describe, it, expect } from 'bun:test'
import { DateField, FieldTypeDate } from '~/core/field_date.ts'
import { CreateField } from '~/core/field.ts'

describe('DateField', () => {
  it('has type "date"', () => {
    const f = new DateField()
    expect(f.type).toBe(FieldTypeDate)
  })

  it('can be created via factory', () => {
    const f = CreateField('date')
    expect(f).toBeInstanceOf(DateField)
  })

  it('column type is TEXT', () => {
    const f = new DateField()
    expect(f.columnType).toBe("TEXT DEFAULT '' NOT NULL")
  })

  it('settings schema is string with date-time format', () => {
    const f = new DateField()
    expect(f.settingsSchema.type).toBe('string')
    expect(f.settingsSchema.format).toBe('date-time')
  })

  describe('validateValue', () => {
    it('returns null for empty value when not required', () => {
      const f = new DateField()
      expect(f.validateValue('')).toBeNull()
    })

    it('returns error for empty value when required', () => {
      const f = new DateField()
      f.required = true
      expect(f.validateValue('')).not.toBeNull()
    })

    it('returns null for valid date', () => {
      const f = new DateField()
      expect(f.validateValue('2024-01-15')).toBeNull()
      expect(f.validateValue('2024-01-15T10:30:00Z')).toBeNull()
    })

    it('returns error for invalid date', () => {
      const f = new DateField()
      expect(f.validateValue('not-a-date')).not.toBeNull()
    })

    it('validates min constraint', () => {
      const f = new DateField()
      f.min = '2024-01-01'
      expect(f.validateValue('2024-06-15')).toBeNull()
      expect(f.validateValue('2023-12-31')).not.toBeNull()
    })

    it('validates max constraint', () => {
      const f = new DateField()
      f.max = '2024-12-31'
      expect(f.validateValue('2024-06-15')).toBeNull()
      expect(f.validateValue('2025-01-01')).not.toBeNull()
    })
  })

  describe('validateSettings', () => {
    it('rejects invalid min date format', () => {
      const f = new DateField()
      f.id = 'fld1'
      f.name = 'date'
      f.min = 'not-a-date'
      const errors = f.validateSettings()
      expect(errors.some((e) => e.includes('min'))).toBe(true)
    })

    it('rejects max < min', () => {
      const f = new DateField()
      f.id = 'fld1'
      f.name = 'date'
      f.min = '2024-12-31'
      f.max = '2024-01-01'
      const errors = f.validateSettings()
      expect(errors.some((e) => e.includes('max'))).toBe(true)
    })
  })
})
