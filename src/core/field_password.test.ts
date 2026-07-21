import { describe, it, expect } from 'bun:test'
import { PasswordField, FieldTypePassword } from '~/core/field_password.ts'
import { CreateField } from '~/core/field.ts'

describe('PasswordField', () => {
  it('has type "password"', () => {
    const f = new PasswordField()
    expect(f.type).toBe(FieldTypePassword)
  })

  it('can be created via factory', () => {
    const f = CreateField('password')
    expect(f).toBeInstanceOf(PasswordField)
  })

  it('column type is TEXT', () => {
    const f = new PasswordField()
    expect(f.columnType).toBe("TEXT DEFAULT '' NOT NULL")
  })

  it('settings schema has writeOnly set to true', () => {
    const f = new PasswordField()
    expect(f.settingsSchema.writeOnly).toBe(true)
    expect(f.settingsSchema.type).toBe('string')
  })

  it('defaults to bcrypt algorithm', () => {
    const f = new PasswordField()
    expect(f.algorithm).toBe('bcrypt')
  })

  it('defaults min to 8 and max to 72', () => {
    const f = new PasswordField()
    expect(f.min).toBe(8)
    expect(f.max).toBe(72)
  })

  describe('validateValue', () => {
    it('returns null for empty value when not required', () => {
      const f = new PasswordField()
      expect(f.validateValue('')).toBeNull()
    })

    it('returns error for empty value when required', () => {
      const f = new PasswordField()
      f.required = true
      expect(f.validateValue('')).not.toBeNull()
    })

    it('validates minimum length', () => {
      const f = new PasswordField()
      expect(f.validateValue('ab')).not.toBeNull()
    })

    it('validates maximum length', () => {
      const f = new PasswordField()
      f.max = 10
      expect(f.validateValue('a'.repeat(11))).not.toBeNull()
    })

    it('validates pattern', () => {
      const f = new PasswordField()
      f.pattern = '^[A-Z]+$'
      expect(f.validateValue('abcdefgh')).not.toBeNull()
      expect(f.validateValue('ABCDEFGH')).toBeNull()
    })

    it('passes for valid password', () => {
      const f = new PasswordField()
      expect(f.validateValue('securePassword123')).toBeNull()
    })
  })

  describe('validateSettings', () => {
    it('validates algorithm', () => {
      const f = new PasswordField()
      f.id = 'fld1'
      f.name = 'password'
      ;(f as Record<string, unknown>).algorithm = 'invalid'
      const errors = f.validateSettings()
      expect(errors.some((e) => e.includes('algorithm'))).toBe(true)
    })

    it('validates pattern regex', () => {
      const f = new PasswordField()
      f.id = 'fld1'
      f.name = 'password'
      f.pattern = '[invalid'
      const errors = f.validateSettings()
      expect(errors.some((e) => e.includes('pattern'))).toBe(true)
    })

    it('validates max >= min', () => {
      const f = new PasswordField()
      f.id = 'fld1'
      f.name = 'password'
      f.min = 10
      f.max = 5
      const errors = f.validateSettings()
      expect(errors.some((e) => e.includes('max'))).toBe(true)
    })
  })
})
