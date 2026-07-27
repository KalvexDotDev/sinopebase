/**
 * Shared helper for unwrapping database select results.
 *
 * IDatabase.select() returns `Record<string, unknown>[]`, but the in-memory
 * adapter wraps results as `{ rows: T[]; total: number }`. This helper
 * normalises both shapes into a flat array without casting to `any`.
 */

export function selectRows<T = Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[]
  if (
    result !== null &&
    typeof result === 'object' &&
    'rows' in result &&
    Array.isArray((result as Record<string, unknown>).rows)
  ) {
    return (result as Record<string, unknown>).rows as T[]
  }
  return []
}
