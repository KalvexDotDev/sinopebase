/**
 * Test-only utilities for safe array access without `any` or `!`.
 *
 * These throw descriptive errors when the assertion fails, which is the
 * intended behaviour in tests — a missing element is a test infrastructure
 * bug, not a recoverable condition.
 */

/** Returns the first element or throws (test infra failure). */
export function first<T>(arr: T[]): T {
  const v = arr[0]
  if (v === undefined) throw new Error('Expected at least one element in array')
  return v
}

/** Decodes a JWT payload from the 2nd dot-separated segment. */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.')
  const segment = parts[1]
  if (!segment) throw new Error('Invalid JWT: missing payload segment')
  return JSON.parse(atob(segment))
}
