/**
 * TextField — stores a text string with optional validation.
 *
 * Port of PocketBase's core/field_text.go (Go -> TypeScript).
 * Layer 2 — imports from ~/tools/*.
 */

import { RegisterField, ValidateFieldName, ValidateFieldId, maxSafeJSONInt } from '~/core/field.ts'
import type { Field } from '~/core/field.ts'

export const FieldTypeText = 'text'

/**
 * TextField defines a "text" type field for storing string values.
 *
 * Supports: min/max length, regex pattern, autogenerate pattern, primary key mode.
 */
export class TextField implements Field {
  id: string = ''
  name: string = ''
  system: boolean = false
  hidden: boolean = false
  readonly type: string = FieldTypeText

  /** Hints the Dashboard UI to use this field in relation preview labels. */
  presentable: boolean = false

  /** Help text shown in the Dashboard UI. */
  help: string = ''

  /** Minimum character length (0 = no minimum). */
  min: number = 0

  /** Maximum character length (0 defaults to 5000). */
  max: number = 0

  /** Optional regex pattern the value must match. */
  pattern: string = ''

  /** Regex pattern for auto-generating values. */
  autogeneratePattern: string = ''

  /** Whether the field is required. */
  required: boolean = false

  /** Whether the field is the primary key. */
  primaryKey: boolean = false

  /** SQL column type for this field. */
  get columnType(): string {
    if (this.primaryKey) {
      return "TEXT PRIMARY KEY DEFAULT ('r'||lower(hex(randomblob(7)))) NOT NULL"
    }
    return "TEXT DEFAULT '' NOT NULL"
  }

  /** JSON Schema fragment for API validation. */
  get settingsSchema(): Record<string, unknown> {
    const schema: Record<string, unknown> = {
      type: 'string',
      default: '',
    }

    if (this.required || this.primaryKey) {
      schema.minLength = this.min > 0 ? this.min : 1
    } else if (this.min > 0) {
      schema.minLength = this.min
    }

    const max = this.max > 0 ? this.max : 5000
    schema.maxLength = max

    if (this.pattern) {
      schema.pattern = this.pattern
    }

    return schema
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

    if (this.primaryKey && this.name !== 'id') {
      errors.push('name: The primary key must be named "id"')
    }

    if (this.min < 0 || this.min > maxSafeJSONInt) {
      errors.push('min: out of valid range')
    }

    if (this.max < this.min || this.max > maxSafeJSONInt) {
      errors.push('max: must be >= min and within valid range')
    }

    if (this.pattern) {
      try {
        new RegExp(this.pattern)
      } catch {
        errors.push('pattern: invalid regular expression')
      }
    }

    if (this.autogeneratePattern) {
      try {
        new RegExp(this.autogeneratePattern)
      } catch {
        errors.push('autogeneratePattern: invalid regular expression')
      }
    }

    return errors
  }
}

// Register with the field factory
RegisterField(FieldTypeText, () => new TextField())
