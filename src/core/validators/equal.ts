/**
 * Equal validator — checks whether two values match.
 *
 * Port of PocketBase's core/validators/equal.go (Go -> TypeScript).
 * Layer 2 — imports from ~/tools/*.
 */

import type { ValidationRule } from '~/core/validators/validators.ts'
import { ValidationError } from '~/core/validators/validators.ts'

/**
 * Returns a validator that checks whether the given value matches the expected value.
 *
 * Works with booleans, numbers, strings, null/undefined, and their pointer-like variants.
 *
 * @example
 *   validateField(form.passwordConfirm, Equal(form.password))
 */
export function Equal<T>(valueToCompare: T): ValidationRule {
  return (value: unknown): ValidationError | null => {
    if (compareValues(value, valueToCompare)) {
      return null
    }
    return new ValidationError('validation_values_mismatch', "Values don't match.")
  }
}

/**
 * Deep-compares two values, handling null, undefined, and primitive wrappers.
 */
function compareValues(a: unknown, b: unknown): boolean {
  // Strict equality handles same-type primitives
  if (a === b) return true

  // Both null or undefined
  if (a == null && b == null) return true

  // If one is null/undefined and the other isn't
  if (a == null || b == null) return false

  // String comparison
  if (typeof a === 'string' && typeof b === 'string') return a === b
  if (typeof a === 'number' && typeof b === 'number') return a === b
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b

  return false
}
