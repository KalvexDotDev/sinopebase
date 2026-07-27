/**
 * SelectField — stores single or multiple string values from a predefined list.
 *
 * Port of PocketBase's core/field_select.go (Go -> TypeScript).
 * Layer 2 — imports from ~/tools/*.
 */

import type { Field } from '~/core/field.ts'
import { RegisterField, ValidateFieldId, ValidateFieldName } from '~/core/field.ts'
import { ToUniqueStringSlice } from '~/tools/list/list.ts'

export const FieldTypeSelect = 'select'

/**
 * SelectField defines a "select" type field for storing single or
 * multiple string values from a predefined list.
 *
 * Requires the Values option to be set.
 *
 * If MaxSelect is not set or <= 1, the field value is a single string.
 * If MaxSelect is > 1, the field value is an array of strings.
 */
export class SelectField implements Field {
  id: string = ''
  name: string = ''
  system: boolean = false
  hidden: boolean = false
  readonly type: string = FieldTypeSelect

  /** Hints the Dashboard UI to use this field in relation preview labels. */
  presentable: boolean = false

  /** Help text shown in the Dashboard UI. */
  help: string = ''

  /** The list of accepted values. */
  values: string[] = []

  /** Max allowed selected values (> 1 enables multi-select). */
  maxSelect: number = 0

  /** Whether the field is required. */
  required: boolean = false

  /** Whether this field supports multiple values. */
  get isMultiple(): boolean {
    return this.maxSelect > 1
  }

  /** SQL column type for this field. */
  get columnType(): string {
    if (this.isMultiple) {
      return "JSON DEFAULT '[]' NOT NULL"
    }
    return "TEXT DEFAULT '' NOT NULL"
  }

  /** JSON Schema fragment for API validation. */
  get settingsSchema(): Record<string, unknown> {
    if (this.isMultiple) {
      return {
        type: 'array',
        items: { type: 'string', enum: this.values },
        default: [],
        uniqueItems: true,
        maxItems: this.maxSelect,
      }
    }

    return {
      type: 'string',
      enum: this.values,
      default: '',
    }
  }

  /** Normalizes a raw value according to single/multi select rules. */
  normalizeValue(raw: unknown): string | string[] {
    const val = ToUniqueStringSlice(raw)

    if (!this.isMultiple) {
      if (val.length > 0) {
        return val[val.length - 1] as string // the last selected
      }
      return ''
    }

    return val
  }

  /** Validates a field value against the allowed values and max select limit. */
  validateValue(raw: unknown): string | null {
    const normalizedVal = ToUniqueStringSlice(raw)

    if (normalizedVal.length === 0) {
      if (this.required) {
        return 'Value is required'
      }
      return null
    }

    const maxSelect = Math.max(this.maxSelect, 1)

    if (normalizedVal.length > maxSelect) {
      return `Select no more than ${maxSelect} value(s)`
    }

    for (const val of normalizedVal) {
      if (!this.values.includes(val)) {
        return `Invalid value "${val}"`
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

    if (this.values.length === 0) {
      errors.push('values: at least one value is required')
    }

    const max = Math.max(this.values.length, 1)
    if (this.maxSelect < 0 || this.maxSelect > max) {
      errors.push(`maxSelect: must be between 0 and ${max}`)
    }

    return errors
  }
}

// Register with the field factory
RegisterField(FieldTypeSelect, () => new SelectField())
