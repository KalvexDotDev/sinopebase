/**
 * PasswordField — stores a bcrypt/argon2 hashed password.
 *
 * Port of PocketBase's core/field_password.go (Go -> TypeScript).
 * Layer 2 — imports from ~/tools/*.
 */

import { RegisterField, ValidateFieldName, ValidateFieldId } from '~/core/field.ts'
import type { Field } from '~/core/field.ts'

export const FieldTypePassword = 'password'

/**
 * Default minimum password length in PocketBase.
 */
const DefaultPasswordMinLength = 8

/**
 * Maximum password length (bcrypt truncates at 72 bytes).
 */
const DefaultPasswordMaxLength = 72

/**
 * Supported hash algorithms.
 */
export type HashAlgorithm = 'bcrypt' | 'argon2'

/**
 * PasswordField defines a "password" type field for storing hashed passwords.
 *
 * The field stores only the hash; the plaintext is available only during
 * validation/setting and is cleared afterward.
 */
export class PasswordField implements Field {
  id: string = ''
  name: string = ''
  system: boolean = false
  hidden: boolean = false
  readonly type: string = FieldTypePassword

  /** Hints the Dashboard UI to use this field in relation preview labels. */
  presentable: boolean = false

  /** Help text shown in the Dashboard UI. */
  help: string = ''

  /** Minimum password length. */
  min: number = DefaultPasswordMinLength

  /** Maximum password length. */
  max: number = DefaultPasswordMaxLength

  /** Optional regex pattern the password must match. */
  pattern: string = ''

  /** Hash algorithm cost factor (for bcrypt) or iteration count (for argon2). */
  cost: number = 0

  /** Hash algorithm to use. */
  algorithm: HashAlgorithm = 'bcrypt'

  /** Whether the field is required. */
  required: boolean = false

  /** SQL column type for this field. */
  get columnType(): string {
    return "TEXT DEFAULT '' NOT NULL"
  }

  /** JSON Schema fragment for API validation. */
  get settingsSchema(): Record<string, unknown> {
    const schema: Record<string, unknown> = {
      type: 'string',
      writeOnly: true,
    }

    schema['minLength'] = this.min > 0 ? this.min : DefaultPasswordMinLength

    const max = this.max > 0 ? this.max : DefaultPasswordMaxLength
    schema['maxLength'] = max

    if (this.pattern) {
      schema['pattern'] = this.pattern
    }

    return schema
  }

  /** Validates a plaintext password against the field constraints. */
  validateValue(plaintext: string): string | null {
    const min = this.min > 0 ? this.min : DefaultPasswordMinLength
    const max = this.max > 0 ? this.max : DefaultPasswordMaxLength

    if (this.required && !plaintext) {
      return 'Value is required'
    }

    if (!plaintext) return null

    if (plaintext.length < min) {
      return `Must be at least ${min} character(s)`
    }

    if (plaintext.length > max) {
      return `Must be no more than ${max} character(s)`
    }

    if (this.pattern) {
      try {
        const re = new RegExp(this.pattern)
        if (!re.test(plaintext)) {
          return 'Invalid value format'
        }
      } catch {
        return 'Invalid password pattern configuration'
      }
    }

    return null
  }

  /** Validates the field settings/configuration. */
  validateSettings(): string[] {
    const errors: string[] = []

    const idErr = ValidateFieldId(this.id)
    if (idErr) errors.push(`id: ${idErr}`)

    const nameErr = ValidateFieldName(this.name)
    if (nameErr) errors.push(`name: ${nameErr}`)

    if (this.help && (this.help.length < 1 || this.help.length > 300)) {
      errors.push('help: must be between 1 and 300 characters')
    }

    if (this.min < 0) {
      errors.push('min: must be >= 0')
    }

    if (this.max > 0 && this.max > DefaultPasswordMaxLength) {
      errors.push(`max: must be <= ${DefaultPasswordMaxLength}`)
    }

    if (this.max > 0 && this.max < this.min) {
      errors.push('max: must be >= min')
    }

    if (this.pattern) {
      try {
        new RegExp(this.pattern)
      } catch {
        errors.push('pattern: invalid regular expression')
      }
    }

    if (this.algorithm !== 'bcrypt' && this.algorithm !== 'argon2') {
      errors.push('algorithm: must be "bcrypt" or "argon2"')
    }

    return errors
  }
}

// Register with the field factory
RegisterField(FieldTypePassword, () => new PasswordField())
