/**
 * File upload validators — size and mime type checks.
 *
 * Port of PocketBase's core/validators/file.go (Go -> TypeScript).
 * Layer 2 — imports from ~/tools/*.
 */

import type { ValidationRule } from '~/core/validators/validators.ts'
import { ErrUnsupportedValueType, ValidationError, cutStr } from '~/core/validators/validators.ts'

/**
 * Represents an uploaded file.
 */
export interface UploadedFile {
  /** Original file name */
  name: string
  /** File size in bytes */
  size: number
  /** MIME type */
  mimeType: string
}

/**
 * Returns a validator that checks whether the uploaded file size
 * does not exceed the given maxBytes.
 *
 * @param maxBytes - Maximum allowed file size in bytes.
 *
 * @example
 *   validateField(file, UploadedFileSize(5 * 1024 * 1024))
 */
export function UploadedFileSize(maxBytes: number): ValidationRule {
  return (value: unknown): ValidationError | null => {
    if (!isUploadedFile(value)) {
      return ErrUnsupportedValueType
    }

    const file = value as UploadedFile

    if (file.size > maxBytes) {
      return new ValidationError(
        'validation_file_size_limit',
        `File size exceeds the maximum allowed size of ${maxBytes} bytes.`,
      ).withParams({
        file: cutStr(file.name, 300),
        maxSize: maxBytes,
      })
    }

    return null
  }
}

/**
 * Returns a validator that checks whether the uploaded file's MIME type
 * is within the list of allowed types.
 *
 * @param validTypes - List of allowed MIME types.
 *
 * @example
 *   validateField(file, UploadedFileMimeType(['image/jpeg', 'image/png']))
 */
export function UploadedFileMimeType(validTypes: string[]): ValidationRule {
  return (value: unknown): ValidationError | null => {
    if (!isUploadedFile(value)) {
      return ErrUnsupportedValueType
    }

    const file = value as UploadedFile

    if (validTypes.length === 0) {
      return new ValidationError(
        'validation_invalid_mime_type',
        `Unsupported file type for "${cutStr(file.name, 300)}".`,
      )
    }

    if (!validTypes.includes(file.mimeType)) {
      return new ValidationError(
        'validation_invalid_mime_type',
        `"${file.name}" mime type must be one of: ${validTypes.join(', ')}.`,
      )
    }

    return null
  }
}

/**
 * Type guard for UploadedFile.
 */
function isUploadedFile(value: unknown): value is UploadedFile {
  if (value === null || value === undefined) return false
  if (typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return typeof obj.name === 'string' && typeof obj.size === 'number'
}
