/**
 * DateField — stores a date/time string value with min/max constraints.
 *
 * Port of PocketBase's core/field_date.go (Go -> TypeScript).
 * Layer 2 — imports from ~/tools/*.
 */

import { RegisterField, ValidateFieldName, ValidateFieldId } from '~/core/field.ts'
import type { Field } from '~/core/field.ts'

export const FieldTypeDate = 'date'

/**
 * DateField defines a "date" type field for storing date/time string values.
 *
 * The respective zero record field value is empty string.
 */
export class DateField implements Field {
  id: string = ''
  name: string = ''
  system: boolean = false
  hidden: boolean = false
  readonly type: string = FieldTypeDate

  /** Hints the Dashboard UI to use this field in relation preview labels. */
  presentable: boolean = false

  /** Help text shown in the Dashboard UI. */
  help: string = ''

  /** Minimum date value (ISO string or empty for no minimum). */
  min: string = ''

  /** Maximum date value (ISO string or empty for no maximum). */
  max: string = ''

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
      format: 'date-time',
      default: '',
    }

    if (this.min) {
      schema['minDate'] = this.min
    }

    if (this.max) {
      schema['maxDate'] = this.max
    }

    return schema
  }

  /** Validates a field value against date format and min/max constraints. */
  validateValue(value: string): string | null {
    if (this.required && !value) {
      return 'Value is required'
    }

    if (!value) return null // nothing to check

    const timestamp = Date.parse(value)
    if (isNaN(timestamp)) {
      return 'Must be a valid date/time value'
    }

    if (this.min) {
      const minTs = Date.parse(this.min)
      if (!isNaN(minTs) && timestamp < minTs) {
        return `Date must not be before ${this.min}`
      }
    }

    if (this.max) {
      const maxTs = Date.parse(this.max)
      if (!isNaN(maxTs) && timestamp > maxTs) {
        return `Date must not be after ${this.max}`
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

    if (this.min && isNaN(Date.parse(this.min))) {
      errors.push('min: invalid date format')
    }

    if (this.max && isNaN(Date.parse(this.max))) {
      errors.push('max: invalid date format')
    }

    if (this.min && this.max && Date.parse(this.min) > Date.parse(this.max)) {
      errors.push('max: must be >= min')
    }

    return errors
  }
}

// Register with the field factory
RegisterField(FieldTypeDate, () => new DateField())
