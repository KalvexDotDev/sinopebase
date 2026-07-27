import { describe, expect, it } from 'bun:test'
import { CreateField } from '~/core/field.ts'
import { FieldTypeURL, URLField } from '~/core/field_url.ts'

describe('URLField', () => {
  it('has type "url"', () => {
    const f = new URLField()
    expect(f.type).toBe(FieldTypeURL)
  })

  it('can be created via factory', () => {
    const f = CreateField('url')
    expect(f).toBeInstanceOf(URLField)
  })

  it('column type is TEXT', () => {
    const f = new URLField()
    expect(f.columnType).toBe("TEXT DEFAULT '' NOT NULL")
  })

  it('settings schema is string with uri format', () => {
    const f = new URLField()
    expect(f.settingsSchema.type).toBe('string')
    expect(f.settingsSchema.format).toBe('uri')
  })

  describe('validateValue', () => {
    it('returns null for empty value when not required', () => {
      const f = new URLField()
      expect(f.validateValue('')).toBeNull()
    })

    it('returns error for empty value when required', () => {
      const f = new URLField()
      f.required = true
      expect(f.validateValue('')).not.toBeNull()
    })

    it('returns null for valid URL', () => {
      const f = new URLField()
      expect(f.validateValue('https://example.com')).toBeNull()
      expect(f.validateValue('http://localhost:3000')).toBeNull()
    })

    it('returns error for invalid URL', () => {
      const f = new URLField()
      expect(f.validateValue('not-a-url')).not.toBeNull()
    })

    it('validates onlyDomains', () => {
      const f = new URLField()
      f.onlyDomains = ['example.com']
      expect(f.validateValue('https://example.com/path')).toBeNull()
      expect(f.validateValue('https://other.com')).not.toBeNull()
    })

    it('validates exceptDomains', () => {
      const f = new URLField()
      f.exceptDomains = ['blocked.com']
      expect(f.validateValue('https://example.com')).toBeNull()
      expect(f.validateValue('https://blocked.com')).not.toBeNull()
    })
  })

  describe('validateSettings', () => {
    it('rejects mutually exclusive domains', () => {
      const f = new URLField()
      f.id = 'fld1'
      f.name = 'url'
      f.onlyDomains = ['a.com']
      f.exceptDomains = ['b.com']
      const errors = f.validateSettings()
      expect(errors.some((e) => e.includes('mutually exclusive'))).toBe(true)
    })
  })
})
