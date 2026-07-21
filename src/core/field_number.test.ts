import { describe, it, expect } from 'bun:test'
import { NumberField, FieldTypeNumber } from '~/core/field_number.ts'
import { CreateField } from '~/core/field.ts'

describe('NumberField', () => {
  it('has type "number"', () => {
    const f = new NumberField()
    expect(f.type).toBe(FieldTypeNumber)
  })

  it('can be created via factory', () => {
    const f = CreateField('number')
    expect(f).toBeInstanceOf(NumberField)
  })

  it('column type is NUMERIC', () => {
    const f = new NumberField()
    expect(f.columnType).toBe('NUMERIC DEFAULT 0 NOT NULL')
  })

  it('default settings schema', () => {
    const f = new NumberField()
    expect(f.settingsSchema).toEqual({
      type: 'number',
      default: 0,
    })
  })

  it('settings schema reflects min/max/onlyInt', () => {
    const f = new NumberField()
    f.min = 0
    f.max = 100
    f.onlyInt = true

    const schema = f.settingsSchema
    expect(schema.type).toBe('number')
    expect(schema.minimum).toBe(0)
    expect(schema.maximum).toBe(100)
    expect(schema.multipleOf).toBe(1)
  })

  it('validateSettings validates min <= max', () => {
    const f = new NumberField()
    f.id = 'fld1'
    f.name = 'test'
    f.min = 10
    f.max = 5
    const errors = f.validateSettings()
    expect(errors.some((e) => e.includes('max'))).toBe(true)
  })
})
