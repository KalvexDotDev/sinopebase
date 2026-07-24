import { describe, it, expect } from 'bun:test'
import { EmailField, FieldTypeEmail } from '~/core/field_email.ts'
import { CreateField } from '~/core/field.ts'

describe('EmailField', () => {
  it('has type "email"', () => {
    const f = new EmailField()
    expect(f.type).toBe(FieldTypeEmail)
  })

  it('can be created via factory', () => {
    const f = CreateField('email')
    expect(f).toBeInstanceOf(EmailField)
  })

  it('column type is TEXT', () => {
    const f = new EmailField()
    expect(f.columnType).toBe("TEXT DEFAULT '' NOT NULL")
  })

  it('settings schema is string with email format', () => {
    const f = new EmailField()
    expect(f.settingsSchema['type']).toBe('string')
    expect(f.settingsSchema['format']).toBe('email')
  })

  describe('validateValue', () => {
    it('returns null for empty value when not required', () => {
      const f = new EmailField()
      expect(f.validateValue('')).toBeNull()
    })

    it('returns error for empty value when required', () => {
      const f = new EmailField()
      f.required = true
      expect(f.validateValue('')).not.toBeNull()
    })

    it('returns null for valid email', () => {
      const f = new EmailField()
      expect(f.validateValue('user@example.com')).toBeNull()
    })

    it('returns error for invalid email format', () => {
      const f = new EmailField()
      expect(f.validateValue('not-an-email')).not.toBeNull()
    })

    it('validates onlyDomains', () => {
      const f = new EmailField()
      f.onlyDomains = ['example.com']
      expect(f.validateValue('user@example.com')).toBeNull()
      expect(f.validateValue('user@other.com')).not.toBeNull()
    })

    it('validates exceptDomains', () => {
      const f = new EmailField()
      f.exceptDomains = ['spam.com']
      expect(f.validateValue('user@example.com')).toBeNull()
      expect(f.validateValue('user@spam.com')).not.toBeNull()
    })
  })

  describe('validateSettings', () => {
    it('rejects mutually exclusive domains', () => {
      const f = new EmailField()
      f.id = 'fld1'
      f.name = 'email'
      f.onlyDomains = ['a.com']
      f.exceptDomains = ['b.com']
      const errors = f.validateSettings()
      expect(errors.some((e) => e.includes('mutually exclusive'))).toBe(true)
    })
  })
})
