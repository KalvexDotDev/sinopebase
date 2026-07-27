import { describe, expect, it } from 'bun:test'
import { CreateField } from '~/core/field.ts'
import { FieldTypeText, TextField } from '~/core/field_text.ts'

describe('TextField', () => {
  it('has type "text"', () => {
    const f = new TextField()
    expect(f.type).toBe(FieldTypeText)
  })

  it('can be created via factory', () => {
    const f = CreateField('text')
    expect(f).toBeInstanceOf(TextField)
  })

  it('default column type is TEXT', () => {
    const f = new TextField()
    expect(f.columnType).toBe("TEXT DEFAULT '' NOT NULL")
  })

  it('returns TEXT PRIMARY KEY column type when primaryKey is true', () => {
    const f = new TextField()
    f.primaryKey = true
    expect(f.columnType).toContain('TEXT PRIMARY KEY')
  })

  it('settings schema reflects min/max/pattern', () => {
    const f = new TextField()
    f.min = 3
    f.max = 100
    f.pattern = '^[a-z]+$'
    f.required = true

    const schema = f.settingsSchema
    expect(schema.type).toBe('string')
    expect(schema.minLength).toBe(3)
    expect(schema.maxLength).toBe(100)
    expect(schema.pattern).toBe('^[a-z]+$')
  })

  it('defaults maxLength to 5000', () => {
    const f = new TextField()
    expect(f.settingsSchema.maxLength).toBe(5000)
  })

  it('default settings schema', () => {
    const f = new TextField()
    expect(f.settingsSchema).toEqual({
      type: 'string',
      default: '',
      maxLength: 5000,
    })
  })

  it('validateSettings returns errors for invalid config', () => {
    const f = new TextField()
    expect(f.validateSettings().length).toBeGreaterThan(0) // no id/name
  })

  it('validateSettings validates help length', () => {
    const f = new TextField()
    f.id = 'fld1'
    f.name = 'test'
    f.help = 'a'.repeat(301)
    const errors = f.validateSettings()
    expect(errors.some((e) => e.includes('help'))).toBe(true)
  })

  it('validateSettings validates pattern regex', () => {
    const f = new TextField()
    f.id = 'fld1'
    f.name = 'test'
    f.pattern = '[invalid'
    const errors = f.validateSettings()
    expect(errors.some((e) => e.includes('pattern'))).toBe(true)
  })
})
