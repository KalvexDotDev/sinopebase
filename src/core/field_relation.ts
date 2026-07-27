/**
 * RelationField — stores single or multiple record references to a related collection.
 *
 * Port of PocketBase's core/field_relation.go (Go -> TypeScript).
 * Layer 2 — imports from ~/tools/*.
 */

import type { Field } from '~/core/field.ts'
import { RegisterField, ValidateFieldId, ValidateFieldName } from '~/core/field.ts'
import { ToUniqueStringSlice } from '~/tools/list/list.ts'

export const FieldTypeRelation = 'relation'

/**
 * RelationField defines a "relation" type field for storing single or
 * multiple collection record references.
 *
 * Requires the CollectionId option to be set.
 *
 * If MaxSelect is not set or <= 1, the field value is a single record id.
 * If MaxSelect is > 1, the field value is an array of record ids.
 */
export class RelationField implements Field {
  id: string = ''
  name: string = ''
  system: boolean = false
  hidden: boolean = false
  readonly type: string = FieldTypeRelation

  /** Hints the Dashboard UI to use this field in relation preview labels. */
  presentable: boolean = false

  /** Help text shown in the Dashboard UI. */
  help: string = ''

  /** The id of the related collection. */
  collectionId: string = ''

  /** Whether the root model should be deleted when all linked relations are deleted. */
  cascadeDelete: boolean = false

  /** Minimum number of allowed relation records (0 = no minimum). */
  minSelect: number = 0

  /** Max allowed relation records (> 1 enables multi-select). */
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
        items: { type: 'string' },
        default: [],
        minItems: this.minSelect > 0 ? this.minSelect : undefined,
        maxItems: this.maxSelect,
      }
    }

    return {
      type: 'string',
      default: '',
    }
  }

  /** Normalizes a raw value according to single/multi relation rules. */
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

  /** Validates a field value against the relation constraints. */
  validateValue(raw: unknown): string | null {
    const ids = ToUniqueStringSlice(raw)

    if (ids.length === 0) {
      if (this.required) {
        return 'Value is required'
      }
      return null
    }

    if (this.minSelect > 0 && ids.length < this.minSelect) {
      return `Select at least ${this.minSelect} value(s)`
    }

    const maxSelect = Math.max(this.maxSelect, 1)
    if (ids.length > maxSelect) {
      return `Select no more than ${maxSelect} value(s)`
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

    if (!this.collectionId) {
      errors.push('collectionId: is required')
    }

    if (this.minSelect < 0) {
      errors.push('minSelect: must be >= 0')
    }

    if (this.maxSelect < this.minSelect) {
      errors.push('maxSelect: must be >= minSelect')
    }

    return errors
  }
}

// Register with the field factory
RegisterField(FieldTypeRelation, () => new RelationField())
