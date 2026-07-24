/**
 * NumberField — stores numeric (float64) values with min/max constraints.
 *
 * Port of PocketBase's core/field_number.go (Go -> TypeScript).
 * Layer 2 — imports from ~/tools/*.
 */

import { RegisterField, ValidateFieldName, ValidateFieldId, maxSafeJSONInt } from '~/core/field.ts'
import type { Field } from '~/core/field.ts'

export const FieldTypeNumber = 'number'

/**
 * NumberField defines a "number" type field for storing numeric values.
 *
 * Supports: min/max constraints, integer-only mode.
 */
export class NumberField implements Field {
  id: string = ''
  name: string = ''
  system: boolean = false
  hidden: boolean = false
  readonly type: string = FieldTypeNumber

  /** Hints the Dashboard UI to use this field in relation preview labels. */
  presentable: boolean = false

  /** Help text shown in the Dashboard UI. */
  help: string = ''

  /** Minimum value (null = no minimum). */
  min: number | null = null

  /** Maximum value (null = no maximum). */
  max: number | null = null

  /** If true, only integer values are allowed. */
  onlyInt: boolean = false

  /** Whether the field is required. */
  required: boolean = false

  /** SQL column type for this field. */
  get columnType(): string {
    return 'NUMERIC DEFAULT 0 NOT NULL'
  }

  /** JSON Schema fragment for API validation. */
  get settingsSchema(): Record<string, unknown> {
    const schema: Record<string, unknown> = {
      type: 'number',
      default: 0,
    }

    if (this.onlyInt) {
      schema['multipleOf'] = 1
    }

    if (this.min !== null) {
      schema['minimum'] = this.min
    }

    if (this.max !== null) {
      schema['maximum'] = this.max
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

    if (this.min !== null && (this.min > maxSafeJSONInt)) {
      errors.push('min: out of valid range')
    }

    if (this.max !== null && (this.max > maxSafeJSONInt)) {
      errors.push('max: out of valid range')
    }

    if (this.min !== null && this.max !== null && this.max < this.min) {
      errors.push('max: must be >= min')
    }

    return errors
  }
}

// Register with the field factory
RegisterField(FieldTypeNumber, () => new NumberField())
