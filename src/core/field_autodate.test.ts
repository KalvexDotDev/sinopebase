import { describe, it, expect } from 'bun:test'
import { AutodateField, FieldTypeAutodate } from '~/core/field_autodate.ts'
import { CreateField } from '~/core/field.ts'

describe('AutodateField', () => {
  it('has type "autodate"', () => {
    const f = new AutodateField()
    expect(f.type).toBe(FieldTypeAutodate)
  })

  it('can be created via factory', () => {
    const f = CreateField('autodate')
    expect(f).toBeInstanceOf(AutodateField)
  })

  it('column type is TEXT', () => {
    const f = new AutodateField()
    expect(f.columnType).toBe("TEXT DEFAULT '' NOT NULL")
  })

  it('settings schema is readOnly date-time', () => {
    const f = new AutodateField()
    expect(f.settingsSchema['type']).toBe('string')
    expect(f.settingsSchema['format']).toBe('date-time')
    expect(f.settingsSchema['readOnly']).toBe(true)
  })

  it('defaults to no onCreate/onUpdate', () => {
    const f = new AutodateField()
    expect(f.onCreate).toBe(false)
    expect(f.onUpdate).toBe(false)
  })

  it('validateSettings requires at least one of onCreate or onUpdate', () => {
    const f = new AutodateField()
    f.id = 'fld1'
    f.name = 'created'
    const errors = f.validateSettings()
    expect(errors.some((e) => e.includes('onCreate') || e.includes('onUpdate'))).toBe(true)
  })

  it('validateSettings passes when onCreate is set', () => {
    const f = new AutodateField()
    f.id = 'fld1'
    f.name = 'created'
    f.onCreate = true
    expect(f.validateSettings()).toHaveLength(0)
  })

  it('validateSettings passes when onUpdate is set', () => {
    const f = new AutodateField()
    f.id = 'fld1'
    f.name = 'updated'
    f.onUpdate = true
    expect(f.validateSettings()).toHaveLength(0)
  })
})
