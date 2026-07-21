/**
 * EmailField — stores a single email string address with domain validation.
 *
 * Port of PocketBase's core/field_email.go (Go -> TypeScript).
 * Layer 2 — imports from ~/tools/*.
 */

import { RegisterField, ValidateFieldName, ValidateFieldId } from '~/core/field.ts'
import type { Field } from '~/core/field.ts'

export const FieldTypeEmail = 'email'

/**
 * Simple email regex for format validation.
 * Matches the majority of common email formats.
 */
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * EmailField defines an "email" type field for storing a single email string address.
 *
 * The respective zero record field value is empty string.
 */
export class EmailField implements Field {
  id: string = ''
  name: string = ''
  system: boolean = false
  hidden: boolean = false
  readonly type: string = FieldTypeEmail

  /** Hints the Dashboard UI to use this field in relation preview labels. */
  presentable: boolean = false

  /** Help text shown in the Dashboard UI. */
  help: string = ''

  /** Domains that are NOT allowed (mutually exclusive with onlyDomains). */
  exceptDomains: string[] = []

  /** Domains that are the ONLY ones allowed (mutually exclusive with exceptDomains). */
  onlyDomains: string[] = []

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
      format: 'email',
      default: '',
    }

    if (this.required) {
      schema.minLength = 1
    }

    return schema
  }

  /** Validates a field value against the email format and domain restrictions. */
  validateValue(value: string): string | null {
    if (this.required && !value) {
      return 'Value is required'
    }

    if (!value) return null // nothing to check

    if (!emailRegex.test(value)) {
      return 'Must be a valid email address'
    }

    const domain = value.slice(value.lastIndexOf('@') + 1)

    if (this.onlyDomains.length > 0 && !this.onlyDomains.includes(domain)) {
      return 'Email domain is not allowed'
    }

    if (this.exceptDomains.length > 0 && this.exceptDomains.includes(domain)) {
      return 'Email domain is not allowed'
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

    if (this.exceptDomains.length > 0 && this.onlyDomains.length > 0) {
      errors.push('exceptDomains and onlyDomains are mutually exclusive')
    }

    return errors
  }
}

// Register with the field factory
RegisterField(FieldTypeEmail, () => new EmailField())
