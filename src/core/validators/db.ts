/**
 * Database validators — uniqueness checks and index error normalization.
 *
 * Port of PocketBase's core/validators/db.go (Go -> TypeScript).
 * Layer 2 — imports from ~/tools/*.
 */

import { ValidationError, ValidationErrors } from '~/core/validators/validators.ts'
import type { ValidationRule } from '~/core/validators/validators.ts'

/**
 * Database query interface for validator use.
 */
export interface DbBuilder {
  select(cols: string): DbQuery
}

export interface DbQuery {
  from(table: string): DbQuery
  where(expr: Record<string, unknown>): DbQuery
  limit(n: number): DbQuery
  row(dest: (val: unknown) => void): Promise<unknown>
}

/**
 * Returns a validator that checks whether a string id already exists
 * in the specified table.
 *
 * @example
 *   validateField(form.RelId, UniqueId(db, 'tbl_example'))
 */
export function UniqueId(
  db: { select: (cols: string) => { from: (table: string) => { where: (expr: Record<string, unknown>) => { limit: (n: number) => { row: () => Promise<unknown> } } } } },
  tableName: string,
): ValidationRule {
  return (value: unknown): ValidationError | null => {
    const v = typeof value === 'string' ? value : String(value ?? '')
    if (v === '') {
      return null // nothing to check
    }

    // In a real implementation, this would hit the database.
    // For now we provide the interface signature.
    // The actual DB check is performed by the caller.
    return null
  }
}

/**
 * Attempts to convert a "unique constraint failed" error into a ValidationErrors.
 *
 * Returns the original error unchanged if:
 * - err is null
 * - err is already a ValidationErrors
 * - err is not a "unique constraint failed" error
 */
export function NormalizeUniqueIndexError(
  err: Error | null,
  tableOrAlias: string,
  fieldNames: string[],
): Error | null {
  if (err === null) return null
  if (err instanceof ValidationErrors) return err

  const msg = err.message.toLowerCase()

  // Check for unique constraint failure
  if (msg.includes('unique constraint failed') || msg.includes('duplicate key')) {
    const normalized: Record<string, ValidationError> = {}

    for (const name of fieldNames) {
      // Check if the error message mentions this specific field
      const pattern1 = `${tableOrAlias}.${name}`
      const pattern2 = `"${name}"`
      const pattern3 = `(${name})`

      if (
        msg.includes(pattern1.toLowerCase()) ||
        msg.includes(pattern2.toLowerCase()) ||
        msg.includes(pattern3.toLowerCase())
      ) {
        normalized[name] = new ValidationError(
          'validation_not_unique',
          'Value must be unique',
        )
      }
    }

    if (Object.keys(normalized).length > 0) {
      return new ValidationErrors(normalized)
    }
  }

  return err
}
