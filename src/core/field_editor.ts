/**
 * EditorField — stores HTML rich text content.
 *
 * Port of PocketBase's core/field_editor.go (Go -> TypeScript).
 * Layer 2 — imports from ~/tools/*.
 */

import { RegisterField, ValidateFieldName, ValidateFieldId, maxSafeJSONInt } from '~/core/field.ts'
import type { Field } from '~/core/field.ts'

export const FieldTypeEditor = 'editor'

/**
 * Default maximum editor field content size: 5MB.
 */
export const DefaultEditorFieldMaxSize = 5 << 20 // 5MB

/**
 * EditorField defines an "editor" type field for storing HTML formatted text.
 *
 * The respective zero record field value is empty string.
 */
export class EditorField implements Field {
  id: string = ''
  name: string = ''
  system: boolean = false
  hidden: boolean = false
  readonly type: string = FieldTypeEditor

  /** Hints the Dashboard UI to use this field in relation preview labels. */
  presentable: boolean = false

  /** Help text shown in the Dashboard UI. */
  help: string = ''

  /** Maximum content size in bytes (0 = default 5MB). */
  maxSize: number = 0

  /** Whether to convert relative URLs to absolute. */
  convertURLs: boolean = false

  /** Whether the field is required. */
  required: boolean = false

  /** The effective maximum size. */
  get effectiveMaxSize(): number {
    return this.maxSize > 0 ? this.maxSize : DefaultEditorFieldMaxSize
  }

  /** SQL column type for this field. */
  get columnType(): string {
    return "TEXT DEFAULT '' NOT NULL"
  }

  /** JSON Schema fragment for API validation. */
  get settingsSchema(): Record<string, unknown> {
    const schema: Record<string, unknown> = {
      type: 'string',
      default: '',
      maxLength: this.effectiveMaxSize,
    }

    if (this.required) {
      schema.minLength = 1
    }

    return schema
  }

  /** Validates a raw value against the field constraints. */
  validateValue(value: string): string | null {
    if (this.required && !value) {
      return 'Value is required'
    }

    if (!value) return null // nothing to check

    if (value.length > this.effectiveMaxSize) {
      return `The maximum allowed content size is ${this.effectiveMaxSize} bytes`
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
RegisterField(FieldTypeEditor, () => new EditorField())
