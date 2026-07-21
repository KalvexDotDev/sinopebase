import { describe, it, expect } from 'bun:test'
import { BoolField, FieldTypeBool } from '~/core/field_bool.ts'
import { CreateField } from '~/core/field.ts'

describe('BoolField', () => {
  it('has type "bool"', () => {
    const f = new BoolField()
    expect(f.type).toBe(FieldTypeBool)
  })

  it('can be created via factory', () => {
    const f = CreateField('bool')
    expect(f).toBeInstanceOf(BoolField)
  })

  it('column type is BOOLEAN', () => {
    const f = new BoolField()
    expect(f.columnType).toBe('BOOLEAN DEFAULT FALSE NOT NULL')
  })

  it('settings schema is boolean with default false', () => {
    const f = new BoolField()
    expect(f.settingsSchema).toEqual({
      type: 'boolean',
      default: false,
    })
  })

  it('validateSettings returns errors for missing id/name', () => {
    const f = new BoolField()
    expect(f.validateSettings().length).toBeGreaterThan(0)
  })

  it('accepts valid config', () => {
    const f = new BoolField()
    f.id = 'fld1'
    f.name = 'active'
    expect(f.validateSettings()).toHaveLength(0)
  })
})
