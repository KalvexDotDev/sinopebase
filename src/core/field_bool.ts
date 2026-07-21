/**
 * BoolField — stores a single true/false boolean value.
 *
 * Port of PocketBase's core/field_bool.go (Go -> TypeScript).
 * Layer 2 — imports from ~/tools/*.
 */

import { RegisterField, ValidateFieldName, ValidateFieldId } from '~/core/field.ts'
import type { Field } from '~/core/field.ts'

export const FieldTypeBool = 'bool'

/**
 * BoolField defines a "bool" type field for storing a single true/false value.
 *
 * The respective zero value is false.
 */
export class BoolField implements Field {
  id: string = ''
  name: string = ''
  system: boolean = false
  hidden: boolean = false
  readonly type: string = FieldTypeBool

  /** Hints the Dashboard UI to use this field in relation preview labels. */
  presentable: boolean = false

  /** Help text shown in the Dashboard UI. */
  help: string = ''

  /** When true, requires the field value to be "true". */
  required: boolean = false

  /** SQL column type for this field. */
  get columnType(): string {
    return 'BOOLEAN DEFAULT FALSE NOT NULL'
  }

  /** JSON Schema fragment for API validation. */
  get settingsSchema(): Record<string, unknown> {
    return {
      type: 'boolean',
      default: false,
    }
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

    return errors
  }
}

// Register with the field factory
RegisterField(FieldTypeBool, () => new BoolField())
