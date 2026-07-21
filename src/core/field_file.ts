/**
 * FileField — manages record file(s) with size, type, and count constraints.
 *
 * Port of PocketBase's core/field_file.go (Go -> TypeScript).
 * Layer 2 — imports from ~/tools/*.
 */

import { RegisterField, ValidateFieldName, ValidateFieldId, maxSafeJSONInt } from '~/core/field.ts'
import type { Field } from '~/core/field.ts'
import { ToUniqueStringSlice } from '~/tools/list/list.ts'

export const FieldTypeFile = 'file'

/**
 * Default maximum file size: 5MB.
 */
export const DefaultFileFieldMaxSize = 5 << 20 // 5MB

/**
 * Regex pattern for loose filename validation.
 */
export const looseFilenameRegex = /^[^./\\][^/\\]+$/

/**
 * FileField defines a "file" type field for managing record file(s).
 *
 * Only the file name is stored as part of the record value.
 * If MaxSelect is not set or <= 1, the field value is a single filename string.
 * If MaxSelect is > 1, the field value is an array of filename strings.
 */
export class FileField implements Field {
  id: string = ''
  name: string = ''
  system: boolean = false
  hidden: boolean = false
  readonly type: string = FieldTypeFile

  /** Hints the Dashboard UI to use this field in relation preview labels. */
  presentable: boolean = false

  /** Help text shown in the Dashboard UI. */
  help: string = ''

  /** Maximum size of a single uploaded file in bytes (0 = default 5MB). */
  maxSize: number = 0

  /** Max allowed files (> 1 enables multi-file). */
  maxSelect: number = 0

  /** Optional list of allowed MIME types (empty = all allowed). */
  mimeTypes: string[] = []

  /** Optional list of supported thumbnail sizes. */
  thumbs: string[] = []

  /** Whether files require a special token to access. */
  protected: boolean = false

  /** Whether the field requires at least one file. */
  required: boolean = false

  /** Whether this field supports multiple values. */
  get isMultiple(): boolean {
    return this.maxSelect > 1
  }

  /** The effective maximum file size. */
  get effectiveMaxSize(): number {
    return this.maxSize > 0 ? this.maxSize : DefaultFileFieldMaxSize
  }

  /** The effective max select count. */
  get effectiveMaxSelect(): number {
    return this.maxSelect > 1 ? this.maxSelect : 1
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
        maxItems: this.effectiveMaxSelect,
      }
    }

    return {
      type: 'string',
      default: '',
    }
  }

  /** Normalizes a raw value according to single/multi file rules. */
  normalizeValue(raw: unknown): string | string[] {
    const files = ToUniqueStringSlice(raw)

    if (!this.isMultiple) {
      if (files.length > 0) {
        return files[files.length - 1] as string // the last selected
      }
      return ''
    }

    return files
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

    if (this.maxSelect < 0 || this.maxSelect > maxSafeJSONInt) {
      errors.push('maxSelect: out of valid range')
    }

    // Validate thumb patterns (basic check)
    if (this.thumbs.length > 0) {
      const thumbRegex = /^\d+x\d+[tbf]?$/
      for (const thumb of this.thumbs) {
        if (!thumbRegex.test(thumb) || thumb === '0x0' || thumb === '0x0t' || thumb === '0x0b' || thumb === '0x0f') {
          errors.push(`thumbs: invalid thumb format "${thumb}"`)
        }
      }
    }

    return errors
  }
}

// Register with the field factory
RegisterField(FieldTypeFile, () => new FileField())
