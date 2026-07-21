/**
 * PostgREST Filter Parsing Utilities
 *
 * Port of PocketBase tools/search/ that parses PostgREST-style
 * query-string filter syntax and applies filters to in-memory data.
 *
 * PostgREST filter format:  column=operator.value
 * OR filter format:         or=(col1.op.val1,col2.op.val2)
 */

import type { ParsedFilter } from '../../core/db-memory'

// ---------------------------------------------------------------------------
// Query-string filter parsing
// ---------------------------------------------------------------------------

const NON_FILTER_KEYS = new Set([
  'select',
  'order',
  'limit',
  'offset',
  'count',
  'apikey',
])

/**
 * Parse a single query-string parameter into a filter.
 *
 * Returns null if the key is not a filter (e.g., `select`, `order`, `or`).
 *
 * @example
 *   parseFilterParam('id', 'eq.123')  → { column: 'id', operator: 'eq', value: '123' }
 *   parseFilterParam('task', 'like.%25test%25') → { column: 'task', operator: 'like', value: '%test%' }
 */
export function parseFilterParam(
  key: string,
  rawValue: string,
): ParsedFilter | null {
  if (NON_FILTER_KEYS.has(key) || key === 'or') {
    return null
  }

  // PostgREST filter format: column=operator.value
  // The value may contain dots (e.g., in.(a,b) or like.%25test%25)
  const dotIndex = rawValue.indexOf('.')
  if (dotIndex === -1) return null

  const operator = rawValue.slice(0, dotIndex)
  const value = rawValue.slice(dotIndex + 1)

  if (!operator || value === undefined) return null

  return { column: key, operator, value }
}

/**
 * Parse the `or=(...)` query parameter.
 *
 * Format: or=(column1.op1.val1,column2.op2.val2)
 * The parentheses are part of the value from the query string.
 *
 * Returns an array of filter groups (each group is ANDed within the OR).
 */
export function parseOrFilters(rawValue: string): ParsedFilter[][] {
  // rawValue should be (filter1,filter2,...)
  let inner = rawValue
  if (inner.startsWith('(') && inner.endsWith(')')) {
    inner = inner.slice(1, -1)
  }

  const groups: ParsedFilter[][] = []

  // Split by commas that separate top-level filters
  // This is tricky because values may contain commas (unlikely for OR but we handle it)
  const parts = splitTopLevelCommas(inner)

  const currentGroup: ParsedFilter[] = []
  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue

    // Each part is column.operator.value
    const firstDot = trimmed.indexOf('.')
    if (firstDot === -1) continue

    const column = trimmed.slice(0, firstDot)
    const rest = trimmed.slice(firstDot + 1)

    const secondDot = rest.indexOf('.')
    if (secondDot === -1) continue

    const operator = rest.slice(0, secondDot)
    const value = rest.slice(secondDot + 1)

    currentGroup.push({ column, operator, value })
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup)
  }

  return groups
}

/**
 * Split a string by commas at the top level (not inside parentheses).
 */
function splitTopLevelCommas(input: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''

  for (const char of input) {
    if (char === '(') {
      depth++
      current += char
    } else if (char === ')') {
      depth--
      current += char
    } else if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += char
    }
  }

  if (current) {
    parts.push(current)
  }

  return parts
}

// ---------------------------------------------------------------------------
// Parse value types
// ---------------------------------------------------------------------------

/**
 * Parse an `in` filter value like `(val1,val2)` into an array of values.
 */
export function parseInValue(raw: string): string[] {
  const inner = raw.startsWith('(') && raw.endsWith(')')
    ? raw.slice(1, -1)
    : raw
  return inner.split(',').map((v) => v.trim()).filter(Boolean)
}

/**
 * Re-export ParsedFilter for convenience.
 */
export type { ParsedFilter }
