/**
 * JSONField — stores any serialized JSON value.
 *
 * Port of PocketBase's core/field_json.go (Go -> TypeScript).
 * Layer 2 — imports from ~/tools/*.
 */

import type { Field } from '~/core/field.ts'
import { maxSafeJSONInt, RegisterField, ValidateFieldId, ValidateFieldName } from '~/core/field.ts'

export const FieldTypeJSON = 'json'

/**
 * Default maximum JSON field size: 1MB.
 */
export const DefaultJSONFieldMaxSize = 1 << 20 // 1MB

/**
 * JSONField defines a "json" type field for storing any serialized JSON value.
 *
 * The respective zero record field value is null.
 */
export class JSONField implements Field {
  id: string = ''
  name: string = ''
  system: boolean = false
  hidden: boolean = false
  readonly type: string = FieldTypeJSON

  /** Hints the Dashboard UI to use this field in relation preview labels. */
  presentable: boolean = false

  /** Help text shown in the Dashboard UI. */
  help: string = ''

  /** Maximum size in bytes (0 = default 1MB limit). */
  maxSize: number = 0

  /** Whether the field is required (non-null, non-empty JSON). */
  required: boolean = false

  /** The effective maximum size. */
  get effectiveMaxSize(): number {
    return this.maxSize > 0 ? this.maxSize : DefaultJSONFieldMaxSize
  }

  /** SQL column type for this field. */
  get columnType(): string {
    return 'JSON DEFAULT NULL'
  }

  /** JSON Schema fragment for API validation. */
  get settingsSchema(): Record<string, unknown> {
    const schema: Record<string, unknown> = {
      type: ['string', 'number', 'boolean', 'object', 'array', 'null'],
      default: null,
    }

    return schema
  }

  /** Normalizes a raw value for JSON storage. */
  prepareValue(raw: unknown): unknown {
    if (typeof raw === 'string') {
      const str = raw as string
      if (str === '') return '""'
      if (str === 'null' || str === 'true' || str === 'false') return str

      // Check if already valid JSON
      try {
        JSON.parse(str)
        return str
      } catch {
        // Wrap in quotes for plain strings
        return JSON.stringify(str)
      }
    }

    return raw
  }

  /** Validates the raw value is valid JSON and within size limits. */
  validateValue(raw: unknown): string | null {
    const rawStr = raw !== null && raw !== undefined ? String(raw) : 'null'

    if (rawStr.length > this.effectiveMaxSize) {
      return `The maximum allowed JSON size is ${this.effectiveMaxSize} bytes`
    }

    try {
      JSON.parse(rawStr)
    } catch {
      return 'Must be a valid JSON value'
    }

    const trimmed = rawStr.trim()
    const emptyValues = ['null', '""', '[]', '{}', '']

    if (this.required && emptyValues.includes(trimmed)) {
      return 'Value is required'
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

    if (this.maxSize < 0 || this.maxSize > maxSafeJSONInt) {
      errors.push('maxSize: out of valid range')
    }

    return errors
  }
}

// Register with the field factory
RegisterField(FieldTypeJSON, () => new JSONField())
