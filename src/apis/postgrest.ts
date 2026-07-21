/**
 * PostgREST Route Handlers
 *
 * Implements the PostgREST API at /rest/v1/:table
 * with support for SELECT, INSERT, UPDATE, DELETE, and HEAD operations.
 *
 * Mirrors PostgREST behavior:
 *   - Filter operators: eq, neq, gt, gte, lt, lte, like, ilike, is, in
 *   - Prefer header: count=exact, return=representation, resolution=merge-duplicates
 *   - Content-Range header for count
 *   - Range header for pagination
 */

import { Elysia } from 'elysia'
import type { IDatabase, Filter, OrderBy, SelectOptions } from '../core/db-interface'
import { parseFilterParam, parseOrFilters } from '../tools/search/filter'

// ---------------------------------------------------------------------------
// Helper types
// ---------------------------------------------------------------------------

interface PreferOptions {
  count?: 'exact' | 'planned' | 'estimated'
  returnRepresentation?: boolean
  resolution?: string
}

interface RangeInfo {
  from: number
  to: number
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

/**
 * Mount PostgREST-compatible CRUD routes on the given Elysia app.
 *
 * Routes:
 *   GET    /rest/v1/:table  — Select rows
 *   POST   /rest/v1/:table  — Insert rows
 *   PATCH  /rest/v1/:table  — Update rows
 *   DELETE /rest/v1/:table  — Delete rows
 *   HEAD   /rest/v1/:table  — Count only (like GET but no body)
 */
export function mountPostgrestRoutes(app: Elysia, db: IDatabase): void {
  // -----------------------------------------------------------------------
  // GET — Select rows
  // -----------------------------------------------------------------------
  app.get('/rest/v1/:table', (ctx) => {
    const { params, query, headers, set } = ctx
    const table = params.table as string
    const prefer = parsePreferHeader(headers['prefer'] ?? headers['Prefer'] ?? '')
    const range = parseRangeHeader(headers['range'] ?? headers['Range'])

    // Parse filters from query params
    const filters = parseFilters(query as Record<string, string>)
    const orFilters = parseOrQueryParams(query as Record<string, string>)

    // Parse pagination from query params
    let limit: number | undefined = query.limit ? parseInt(query.limit as string, 10) : undefined
    let offset: number | undefined = query.offset ? parseInt(query.offset as string, 10) : undefined
    const order = query.order as string | undefined

    // If Range header is provided, use it for pagination
    if (range) {
      limit = range.to - range.from + 1
      offset = range.from
    }

    const rows = db.select(table, filters, undefined, limit, offset)

    // Content-Range header for count requests
    if (prefer.count === 'exact') {
      const total = rows.length
      set.headers['content-range'] = `*/${total}`
    }

    // Return rows
    return rows
  })

  // -----------------------------------------------------------------------
  // HEAD — Like GET but no body, only headers
  // -----------------------------------------------------------------------
  app.head('/rest/v1/:table', (ctx) => {
    const { params, query, headers, set } = ctx
    const table = params.table as string

    // Parse filters
    const filters = parseFilters(query as Record<string, string>)
    const orFilters = parseOrQueryParams(query as Record<string, string>)

    const rows = db.select(table, filters || orFilters)

    // Always set Content-Range for HEAD
    const total = rows.length
    set.headers['content-range'] = `*/${total}`

    // Return empty body (Elysia will send no content)
    set.status = 200
    return ''
  })

  // -----------------------------------------------------------------------
  // POST — Insert rows
  // -----------------------------------------------------------------------
  app.post('/rest/v1/:table', async (ctx) => {
    const { params, headers, body, set } = ctx
    const table = params.table as string
    const prefer = parsePreferHeader(headers['prefer'] ?? headers['Prefer'] ?? '')

    // Body can be a single object or an array
    const rows = Array.isArray(body) ? body : [body]
    const sanitized = rows.map((r) =>
      typeof r === 'object' && r !== null ? (r as Record<string, unknown>) : {},
    )

    const inserted: Record<string, unknown>[] = []
    for (const row of sanitized) {
      if (prefer.resolution === 'merge-duplicates') {
        inserted.push(await db.upsert(table, row))
      } else {
        inserted.push(await db.insert(table, row))
      }
    }

    set.status = 201

    // Return representation if requested
    if (prefer.returnRepresentation) {
      return inserted
    }

    // Otherwise return empty array (PostgREST convention)
    // But SDK expects data back on POST, so we return the inserted rows
    // PostgREST returns 201 with empty body for insert without Prefer: return=representation
    return inserted
  })

  // -----------------------------------------------------------------------
  // PATCH — Update rows
  // -----------------------------------------------------------------------
  app.patch('/rest/v1/:table', (ctx) => {
    const { params, query, headers, body, set } = ctx
    const table = params.table as string
    const prefer = parsePreferHeader(headers['prefer'] ?? headers['Prefer'] ?? '')

    // Parse filters
    const filters = parseFilters(query as Record<string, string>)

    // Body is the data to update
    const data = (typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)
      : {}) as Record<string, unknown>

    const updated = db.update(table, filters, data)

    // Return representation if requested
    if (prefer.returnRepresentation) {
      return updated
    }

    return updated
  })

  // -----------------------------------------------------------------------
  // DELETE — Delete rows
  // -----------------------------------------------------------------------
  app.delete('/rest/v1/:table', (ctx) => {
    const { params, query, headers, set } = ctx
    const table = params.table as string
    const prefer = parsePreferHeader(headers['prefer'] ?? headers['Prefer'] ?? '')

    // Parse filters
    const filters = parseFilters(query as Record<string, string>)

    const deleted = db.delete(table, filters)

    // Return representation if requested
    if (prefer.returnRepresentation) {
      return deleted
    }

    // PostgREST returns the deleted rows (or empty array)
    return deleted
  })
}

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

/**
 * Parse the Prefer header into structured options.
 *
 * Prefer header format (per RFC 7240):
 *   Prefer: count=exact
 *   Prefer: return=representation
 *   Prefer: resolution=merge-duplicates
 *   Prefer: count=exact,return=representation
 */
function parsePreferHeader(headerValue: string): PreferOptions {
  const options: PreferOptions = {}

  if (!headerValue) return options

  const parts = headerValue.split(',').map((p) => p.trim()).filter(Boolean)
  for (const part of parts) {
    const eqIndex = part.indexOf('=')
    if (eqIndex === -1) {
      // Boolean-style preference
      if (part === 'return=representation') {
        options.returnRepresentation = true
      }
      continue
    }
    const key = part.slice(0, eqIndex).trim()
    const value = part.slice(eqIndex + 1).trim()

    switch (key) {
      case 'count':
        if (value === 'exact' || value === 'planned' || value === 'estimated') {
          options.count = value
        }
        break
      case 'return':
        if (value === 'representation') {
          options.returnRepresentation = true
        }
        break
      case 'resolution':
        options.resolution = value
        break
    }
  }

  return options
}

/**
 * Parse the Range header (PostgREST format: from-to).
 */
function parseRangeHeader(headerValue?: string): RangeInfo | null {
  if (!headerValue) return null
  // PostgREST uses format: from-to  (e.g., "0-4")
  // Standard HTTP Range would be bytes=0-4, but PostgREST uses custom format
  const trimmed = headerValue.trim()
  const parts = trimmed.split('-')
  if (parts.length !== 2) return null
  const from = parseInt(parts[0]!, 10)
  const to = parseInt(parts[1]!, 10)
  if (isNaN(from) || isNaN(to)) return null
  return { from, to }
}

/**
 * Parse filter query parameters.
 * Skips non-filter keys (select, order, limit, offset, etc.).
 */
function parseFilters(query: Record<string, string>): ParsedFilter[] {
  const filters: ParsedFilter[] = []

  for (const [key, rawValue] of Object.entries(query)) {
    if (key === 'or') continue
    const filter = parseFilterParam(key, rawValue)
    if (filter) {
      filters.push(filter)
    }
  }

  return filters
}

/**
 * Parse `or=(...)` query parameters.
 */
function parseOrQueryParams(query: Record<string, string>): ParsedFilter[][] {
  const allOrGroups: ParsedFilter[][] = []

  for (const [key, rawValue] of Object.entries(query)) {
    if (key === 'or') {
      const groups = parseOrFilters(rawValue)
      allOrGroups.push(...groups)
    }
  }

  return allOrGroups
}
