/**
 * In-Memory Database for Sinopebase
 *
 * Implements a simple in-memory data store for PostgREST operations.
 * Used when no PostgreSQL connection is available.
 *
 * Each table is a Map<string, Record<string, unknown>> keyed by row id.
 */

import { randomUUID } from 'node:crypto'
import { parseInValue } from '~/tools/search/filter'

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------

export interface ParsedFilter {
  column: string
  operator: string
  value: unknown
}

export interface SelectOptions {
  filters?: ParsedFilter[]
  orFilters?: ParsedFilter[][]
  order?: string
  limit?: number
  offset?: number
}

// ---------------------------------------------------------------------------
// MemoryDatabase
// ---------------------------------------------------------------------------

export class MemoryDatabase {
  private tables: Map<string, Map<string, Record<string, unknown>>> = new Map()

  /**
   * Create a new table. No-op if it already exists.
   */
  createTable(name: string): void {
    if (!this.tables.has(name)) {
      this.tables.set(name, new Map())
    }
  }

  /**
   * Check if a table exists.
   */
  hasTable(name: string): boolean {
    return this.tables.has(name)
  }

  /**
   * Drop a table.
   */
  dropTable(name: string): void {
    this.tables.delete(name)
  }

  /**
   * Get or create a table store.
   */
  private getTable(name: string): Map<string, Record<string, unknown>> {
    if (!this.tables.has(name)) {
      this.tables.set(name, new Map())
    }
    const t = this.tables.get(name)
    if (!t) throw new Error(`Table ${name} not found`)
    return t
  }

  // -----------------------------------------------------------------------
  // CRUD operations
  // -----------------------------------------------------------------------

  /**
   * Insert rows. Auto-generates `id` if not provided.
   * Returns the inserted rows.
   */
  insert(table: string, rows: Record<string, unknown>[]): Record<string, unknown>[] {
    const store = this.getTable(table)
    const inserted: Record<string, unknown>[] = []
    for (const row of rows) {
      const id = (row.id as string) ?? randomUUID()
      const newRow = { ...row, id }
      store.set(id, newRow)
      inserted.push(newRow)
    }
    return inserted
  }

  /**
   * Upsert rows — merge on matching `id`. If no `id`, insert.
   */
  upsert(table: string, rows: Record<string, unknown>[]): Record<string, unknown>[] {
    const store = this.getTable(table)
    const results: Record<string, unknown>[] = []
    for (const row of rows) {
      const id = (row.id as string) ?? randomUUID()
      const existing = store.get(id)
      if (existing) {
        const merged = { ...existing, ...row, id }
        store.set(id, merged)
        results.push(merged)
      } else {
        const newRow = { ...row, id }
        store.set(id, newRow)
        results.push(newRow)
      }
    }
    return results
  }

  /**
   * Select rows matching filters, with optional sorting and pagination.
   * Returns { rows, total } where total is the count before pagination.
   */
  select(
    table: string,
    options: SelectOptions = {},
  ): { rows: Record<string, unknown>[]; total: number } {
    const store = this.getTable(table)
    let rows = Array.from(store.values())

    // Apply individual column filters (AND)
    if (options.filters && options.filters.length > 0) {
      const f = options.filters
      if (f) rows = rows.filter((row) => this.matchesAllFilters(row, f))
    }

    // Apply OR filters (OR of AND groups)
    if (options.orFilters && options.orFilters.length > 0) {
      rows = rows.filter((row) =>
        options.orFilters?.some((group) => this.matchesAllFilters(row, group)),
      )
    }

    const total = rows.length

    // Apply sorting
    if (options.order) {
      rows = this.applySort(rows, options.order)
    }

    // Apply offset
    if (options.offset !== undefined && options.offset > 0) {
      rows = rows.slice(options.offset)
    }

    // Apply limit
    if (options.limit !== undefined && options.limit >= 0) {
      rows = rows.slice(0, options.limit)
    }

    return { rows, total }
  }

  /**
   * Update rows matching filters with the given data.
   * When ids is provided, only those rows are updated (used for or-filter mutations).
   * Returns the updated rows.
   */
  update(
    table: string,
    filters: ParsedFilter[],
    data: Record<string, unknown>,
    ids?: string[],
  ): Record<string, unknown>[] {
    const store = this.getTable(table)
    const updated: Record<string, unknown>[] = []
    const idSet = ids ? new Set(ids) : undefined

    for (const [id, row] of store) {
      const matches = idSet ? idSet.has(id) : this.matchesAllFilters(row, filters)
      if (matches) {
        const newRow = { ...row, ...data, id }
        store.set(id, newRow)
        updated.push(newRow)
      }
    }

    return updated
  }

  /**
   * Delete rows matching filters.
   * When ids is provided, only those rows are deleted (used for or-filter mutations).
   * Returns the deleted rows.
   */
  delete(table: string, filters: ParsedFilter[], ids?: string[]): Record<string, unknown>[] {
    const store = this.getTable(table)
    const deleted: Record<string, unknown>[] = []
    const idsToDelete: string[] = []
    const idSet = ids ? new Set(ids) : undefined

    for (const [id, row] of store) {
      const matches = idSet ? idSet.has(id) : this.matchesAllFilters(row, filters)
      if (matches) {
        idsToDelete.push(id)
        deleted.push(row)
      }
    }

    for (const id of idsToDelete) {
      store.delete(id)
    }

    return deleted
  }

  /**
   * Count rows matching filters (no pagination).
   */
  count(table: string, filters: ParsedFilter[] = []): number {
    const store = this.getTable(table)
    let rows = Array.from(store.values())

    if (filters.length > 0) {
      rows = rows.filter((row) => this.matchesAllFilters(row, filters))
    }

    return rows.length
  }

  // -----------------------------------------------------------------------
  // Filter matching
  // -----------------------------------------------------------------------

  private matchesAllFilters(row: Record<string, unknown>, filters: ParsedFilter[]): boolean {
    return filters.every((f) => this.matchesFilter(row, f))
  }

  private matchesFilter(row: Record<string, unknown>, filter: ParsedFilter): boolean {
    const { column, operator, value } = filter
    const rowValue = row[column]

    switch (operator) {
      case 'eq':
        return this.compareEq(rowValue, value)
      case 'neq':
        // PostgREST semantics: neq.null → IS NOT NULL
        if (value === null || value === 'null') return rowValue !== null && rowValue !== undefined
        return !this.compareEq(rowValue, value)
      case 'gt':
        return this.compareOrdered(rowValue, value) > 0
      case 'gte':
        return this.compareOrdered(rowValue, value) >= 0
      case 'lt':
        return this.compareOrdered(rowValue, value) < 0
      case 'lte':
        return this.compareOrdered(rowValue, value) <= 0
      case 'like':
        return this.matchLike(rowValue, value, false)
      case 'ilike':
        return this.matchLike(rowValue, value, true)
      case 'is': {
        if (value === null || value === 'null') return rowValue === null || rowValue === undefined
        if (value === true || value === 'true') return rowValue === true
        if (value === false || value === 'false') return rowValue === false
        return String(rowValue) === String(value)
      }
      case 'in': {
        // Parse (val1,val2,...) format; double-quoted values may contain commas
        const values = Array.isArray(value) ? value : parseInValue(String(value))
        return values.some((v) => this.compareEq(rowValue, v))
      }
      case 'not': {
        throw new Error(`Unsupported filter operator: ${operator}`)
      }
      default:
        throw new Error(`Unsupported filter operator: ${operator}`)
    }
  }

  private compareEq(rowValue: unknown, value: unknown): boolean {
    if (rowValue === null || rowValue === undefined) return false
    return String(rowValue) === String(value)
  }

  private compareOrdered(rowValue: unknown, value: unknown): number {
    if (rowValue === null || rowValue === undefined) {
      // null is always "less than" any actual value
      return -1
    }
    const strVal = String(rowValue)
    // Try numeric comparison if both are numbers
    const numRow = Number(strVal)
    const valueString = String(value)
    const numVal = Number(valueString)
    if (!Number.isNaN(numRow) && !Number.isNaN(numVal) && valueString !== '') {
      return numRow - numVal
    }
    // String comparison
    return strVal.localeCompare(valueString)
  }

  private matchLike(rowValue: unknown, pattern: unknown, caseInsensitive: boolean): boolean {
    if (rowValue === null || rowValue === undefined) return false
    const strVal = String(rowValue)
    // Convert SQL LIKE pattern to regex
    const regexStr = String(pattern)
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/%/g, '.*')
      .replace(/_/g, '.')
    try {
      const flags = caseInsensitive ? 'i' : ''
      return new RegExp(`^${regexStr}$`, flags).test(strVal)
    } catch {
      return false
    }
  }

  // -----------------------------------------------------------------------
  // Sorting
  // -----------------------------------------------------------------------

  private applySort(rows: Record<string, unknown>[], order: string): Record<string, unknown>[] {
    const orderParts = order.split(',')

    // Apply sorts from last to first (stable multi-column sort)
    for (let i = orderParts.length - 1; i >= 0; i--) {
      const part = orderParts[i]?.trim()
      const segments = part.split('.')
      const column = segments[0]
      if (!column) continue
      const dir = segments[1]
      const rest = segments.slice(2)
      const ascending = dir !== 'desc'
      const nullsFirst = rest.includes('nullsfirst')

      rows = [...rows].sort((a, b) => {
        const aVal = a[column]
        const bVal = b[column]

        // Handle nulls
        if (aVal === null || aVal === undefined) {
          if (bVal === null || bVal === undefined) return 0
          return nullsFirst ? -1 : 1
        }
        if (bVal === null || bVal === undefined) {
          return nullsFirst ? 1 : -1
        }

        // Compare
        let cmp: number
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          cmp = aVal - bVal
        } else if (typeof aVal === 'boolean' && typeof bVal === 'boolean') {
          cmp = aVal === bVal ? 0 : aVal ? 1 : -1
        } else if (typeof aVal === 'string' && typeof bVal === 'string') {
          // Try numeric comparison first
          const aNum = Number(aVal)
          const bNum = Number(bVal)
          if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) {
            cmp = aNum - bNum
          } else {
            cmp = aVal.localeCompare(bVal)
          }
        } else {
          cmp = String(aVal).localeCompare(String(bVal))
        }

        return ascending ? cmp : -cmp
      })
    }

    return rows
  }
}
