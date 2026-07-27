/**
 * AutodateField — auto-sets the current date/time on record create/update.
 *
 * Port of PocketBase's core/field_autodate.go (Go -> TypeScript).
 * Layer 2 — imports from ~/tools/*.
 */

import type { Field } from '~/core/field.ts'
import { RegisterField, ValidateFieldId, ValidateFieldName } from '~/core/field.ts'

export const FieldTypeAutodate = 'autodate'

/**
 * AutodateField defines an "autodate" type field whose datetime value
 * can be automatically set on record create/update.
 *
 * Usually used for defining timestamp fields like "created" and "updated".
 * Requires either both or at least one of OnCreate or OnUpdate options to be set.
 */
export class AutodateField implements Field {
  id: string = ''
  name: string = ''
  system: boolean = false
  hidden: boolean = false
  readonly type: string = FieldTypeAutodate

  /** Hints the Dashboard UI to use this field in relation preview labels. */
  presentable: boolean = false

  /** Auto sets the current datetime as field value on record create. */
  onCreate: boolean = false

  /** Auto sets the current datetime as field value on record update. */
  onUpdate: boolean = false

  /** SQL column type for this field. */
  get columnType(): string {
    return "TEXT DEFAULT '' NOT NULL"
  }

  /** JSON Schema fragment for API validation. */
  get settingsSchema(): Record<string, unknown> {
    return {
      type: 'string',
      format: 'date-time',
      default: '',
      readOnly: true,
    }
  }

  /** Validates the field settings/configuration. */
  validateSettings(): string[] {
    const errors: string[] = []

    const idErr = ValidateFieldId(this.id)
    if (idErr) errors.push(`id: ${idErr}`)

    const nameErr = ValidateFieldName(this.name)
    if (nameErr) errors.push(`name: ${nameErr}`)

    if (!this.onCreate && !this.onUpdate) {
      errors.push('either onCreate or onUpdate must be enabled')
    }

    return errors
  }
}

// Register with the field factory
RegisterField(FieldTypeAutodate, () => new AutodateField())
