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

import type { Elysia } from 'elysia'
import type { ForeignKeyRelationship, IDatabase, OrderBy } from '../core/db-interface'
import type { ParsedFilter } from '../core/db-memory'
import { PostgresDatabase, type PostgresRequestContext } from '../core/db-postgres'
import { parseFilterParam, parseOrFilters } from '../tools/search/filter'
import type { PostgresChange, PostgrestChangePublisher, PreparedRealtimeChange } from './realtime'

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

interface PostgrestSelectOptions {
  filters: ParsedFilter[]
  orFilters: ParsedFilter[][]
  order?: string
  limit?: number
  offset?: number
}

interface ColumnSelection {
  kind: 'column'
  source: string
  output: string
}

interface RelationshipSelection {
  kind: 'relationship'
  selector: string
  hint?: string
  output: string
  inner: boolean
  fields: Selection[]
}

type Selection = ColumnSelection | RelationshipSelection

interface SelectedRow {
  source: Record<string, unknown>
  result: Record<string, unknown>
}

interface SelectResult {
  rows: Record<string, unknown>[]
  total: number
}

interface SingularResponse {
  body: Record<string, unknown>
  status?: 406
  contentType?: string
}

export type PostgrestContextResolver = (request: Request) => PostgresRequestContext | undefined

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
export function mountPostgrestRoutes(
  app: Elysia,
  db: IDatabase,
  resolveContext?: PostgrestContextResolver,
  changes?: PostgrestChangePublisher,
): void {
  // -----------------------------------------------------------------------
  // GET — Select rows
  // -----------------------------------------------------------------------
  app.get('/rest/v1/:table', async (ctx) => {
    const { params, query, headers, request, set } = ctx
    const table = params.table as string
    const prefer = parsePreferHeader(headers.prefer ?? headers.Prefer ?? '')
    const range = parseRangeHeader(headers.range ?? headers.Range)

    // Parse filters from query params
    const filters = parseFilters(query as Record<string, string>)
    const orFilters = parseOrQueryParams(query as Record<string, string>)

    // Elysia automatically serves HEAD through a matching GET route, so handle
    // it before selecting rows. Supabase uses this path for head/count queries.
    if (request.method === 'HEAD') {
      const total = await withRequestDatabase(db, request, resolveContext, (requestDb) =>
        countRows(requestDb, table, filters, orFilters),
      )
      set.headers['content-range'] = `*/${total}`
      set.status = 200
      return ''
    }

    // Parse pagination from query params
    let limit: number | undefined = query.limit ? parseInt(query.limit as string, 10) : undefined
    let offset: number | undefined = query.offset ? parseInt(query.offset as string, 10) : undefined
    const order = query.order as string | undefined

    // If Range header is provided, use it for pagination
    if (range) {
      limit = range.to - range.from + 1
      offset = range.from
    }

    const { rows, total } = await withRequestDatabase(
      db,
      ctx.request,
      resolveContext,
      async (requestDb) => {
        const selected = await selectRows(requestDb, table, {
          filters,
          orFilters,
          order,
          limit,
          offset,
        })
        const selectedRows = query.select
          ? await applySelection(requestDb, table, selected.rows, query.select)
          : selected.rows
        const selectedTotal = query.select?.includes('!inner')
          ? selectedRows.length
          : prefer.count === 'exact'
            ? await countRows(requestDb, table, filters, orFilters, selected.total)
            : selected.total
        return { rows: selectedRows, total: selectedTotal }
      },
    )

    // Content-Range header for count requests
    if (prefer.count === 'exact') {
      set.headers['content-range'] = `*/${total}`
    }

    const singular = buildSingularResponse(rows, headers.accept ?? headers.Accept)
    if (singular) {
      if (singular.status) set.status = singular.status
      if (singular.contentType) set.headers['content-type'] = singular.contentType
      return singular.body
    }

    // Return rows
    return rows
  })

  // -----------------------------------------------------------------------
  // HEAD — Like GET but no body, only headers
  // -----------------------------------------------------------------------
  app.head('/rest/v1/:table', async (ctx) => {
    const { params, query, set } = ctx
    const table = params.table as string

    // Parse filters
    const filters = parseFilters(query as Record<string, string>)
    const orFilters = parseOrQueryParams(query as Record<string, string>)

    const total = await withRequestDatabase(db, ctx.request, resolveContext, (requestDb) =>
      countRows(requestDb, table, filters, orFilters),
    )
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
    const prefer = parsePreferHeader(headers.prefer ?? headers.Prefer ?? '')

    // Body can be a single object or an array
    const rows = Array.isArray(body) ? body : [body]
    const sanitized = rows.map((r) =>
      typeof r === 'object' && r !== null ? (r as Record<string, unknown>) : {},
    )

    const inserted = await withRequestDatabase(
      db,
      ctx.request,
      resolveContext,
      async (requestDb) => {
        const results: Record<string, unknown>[] = []
        for (const row of sanitized) {
          if (prefer.resolution === 'merge-duplicates') {
            results.push(await requestDb.upsert(table, row))
          } else {
            results.push(await requestDb.insert(table, row))
          }
        }
        return results
      },
    )

    if (changes) {
      for (const row of inserted) {
        await changes.publishPostgresChange({
          schema: 'public',
          table,
          event: 'INSERT',
          new: row,
          old: {},
        })
      }
    }

    set.status = 201

    const singular = buildSingularResponse(inserted, headers.accept ?? headers.Accept)
    if (singular) {
      if (singular.status) set.status = singular.status
      if (singular.contentType) set.headers['content-type'] = singular.contentType
      return singular.body
    }

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
  app.patch('/rest/v1/:table', async (ctx) => {
    const { params, query, headers, body, set } = ctx
    const table = params.table as string
    const prefer = parsePreferHeader(headers.prefer ?? headers.Prefer ?? '')

    // Parse filters
    const filters = parseFilters(query as Record<string, string>)

    // Body is the data to update
    const data = (
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
    ) as Record<string, unknown>

    const { updated, previous } = await withRequestDatabase(
      db,
      ctx.request,
      resolveContext,
      async (requestDb) => {
        const previous = changes
          ? (await selectRows(requestDb, table, { filters, orFilters: [] })).rows
          : []
        const updated = await requestDb.update(table, filters, data)
        return { updated, previous }
      },
    )

    if (changes) {
      for (const row of updated) {
        const old = previous.find((candidate) => candidate.id === row.id) ?? {}
        await changes.publishPostgresChange(postgresChange(table, 'UPDATE', row, old))
      }
    }

    const singular = buildSingularResponse(updated, headers.accept ?? headers.Accept)
    if (singular) {
      if (singular.status) set.status = singular.status
      if (singular.contentType) set.headers['content-type'] = singular.contentType
      return singular.body
    }

    // Return representation if requested
    if (prefer.returnRepresentation) {
      return updated
    }

    return updated
  })

  // -----------------------------------------------------------------------
  // DELETE — Delete rows
  // -----------------------------------------------------------------------
  app.delete('/rest/v1/:table', async (ctx) => {
    const { params, query, headers, set } = ctx
    const table = params.table as string
    const prefer = parsePreferHeader(headers.prefer ?? headers.Prefer ?? '')

    // Parse filters
    const filters = parseFilters(query as Record<string, string>)

    const { deleted, prepared } = await withRequestDatabase(
      db,
      ctx.request,
      resolveContext,
      async (requestDb) => {
        const previous = changes
          ? (await selectRows(requestDb, table, { filters, orFilters: [] })).rows
          : []
        const prepared: PreparedRealtimeChange[] = []
        if (changes) {
          for (const row of previous) {
            prepared.push(
              await changes.preparePostgresChange(postgresChange(table, 'DELETE', {}, row)),
            )
          }
        }
        const deleted = await requestDb.delete(table, filters)
        return { deleted, prepared }
      },
    )

    for (const delivery of prepared) delivery.deliver()

    const singular = buildSingularResponse(deleted, headers.accept ?? headers.Accept)
    if (singular) {
      if (singular.status) set.status = singular.status
      if (singular.contentType) set.headers['content-type'] = singular.contentType
      return singular.body
    }

    // Return representation if requested
    if (prefer.returnRepresentation) {
      return deleted
    }

    // PostgREST returns the deleted rows (or empty array)
    return deleted
  })
}

function postgresChange(
  table: string,
  event: PostgresChange['event'],
  newRecord: Record<string, unknown>,
  oldRecord: Record<string, unknown>,
): PostgresChange {
  return {
    schema: 'public',
    table,
    event,
    new: newRecord,
    old: oldRecord,
  }
}

async function withRequestDatabase<T>(
  db: IDatabase,
  request: Request,
  resolveContext: PostgrestContextResolver | undefined,
  operation: (requestDb: IDatabase) => Promise<T>,
): Promise<T> {
  if (!(db instanceof PostgresDatabase) || !resolveContext) return operation(db)

  const context = resolveContext(request)
  if (!context) throw new Error('PostgREST request reached the database without an auth context')

  return db.withRequestContext(context, operation)
}

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

/**
 * Execute a select query using the canonical options-object API.
 */
async function selectRows(
  db: IDatabase,
  table: string,
  options: PostgrestSelectOptions,
): Promise<SelectResult> {
  const rows = await db.select(table, {
    filters: options.filters,
    orFilters: options.orFilters.filter((group) => group.length > 0),
    order: parseOrderParam(options.order),
    limit: options.limit,
    offset: options.offset,
  })
  return { rows, total: rows.length }
}

async function countRows(
  db: IDatabase,
  table: string,
  filters: ParsedFilter[],
  orFilters: ParsedFilter[][],
  memoryTotal?: number,
): Promise<number> {
  if (memoryTotal !== undefined) return memoryTotal
  const filteredOrGroups = orFilters.filter((group) => group.length > 0)
  if (filteredOrGroups.length > 0) {
    // OR-filtered count requires a select pass (db.count only supports flat filters).
    const rows = await db.select(table, { filters, orFilters: filteredOrGroups })
    return rows.length
  }
  return db.count(table, filters)
}

function parseOrderParam(rawOrder?: string): OrderBy[] | undefined {
  if (!rawOrder) return undefined

  const order = rawOrder
    .split(',')
    .map((part): OrderBy | null => {
      const [rawColumn, rawDirection] = part.trim().split('.')
      const column = rawColumn?.trim()
      if (!column) return null

      return {
        column,
        direction: rawDirection === 'desc' ? 'desc' : 'asc',
      }
    })
    .filter((part): part is OrderBy => part !== null)

  return order.length > 0 ? order : undefined
}

async function applySelection(
  db: IDatabase,
  table: string,
  rows: Record<string, unknown>[],
  rawSelect: string,
): Promise<Record<string, unknown>[]> {
  const selections = parseSelect(rawSelect)
  const selected = await materializeSelection(db, table, rows, selections)
  return selected.map(({ result }) => result)
}

async function materializeSelection(
  db: IDatabase,
  table: string,
  rows: Record<string, unknown>[],
  selections: Selection[],
): Promise<SelectedRow[]> {
  let selectedRows = rows.map((source) => ({
    source,
    result: projectColumns(source, selections),
  }))

  for (const selection of selections) {
    if (selection.kind !== 'relationship') continue

    const relationship = await resolveRelationship(db, table, selection)
    const outbound = relationship.sourceTable === table
    const localColumn = outbound ? relationship.sourceColumn : relationship.targetColumn
    const relatedTable = outbound ? relationship.targetTable : relationship.sourceTable
    const relatedColumn = outbound ? relationship.targetColumn : relationship.sourceColumn
    const localValues = [
      ...new Set(
        selectedRows
          .map(({ source }) => source[localColumn])
          .filter((value) => value !== null && value !== undefined),
      ),
    ]

    const relatedRows =
      localValues.length === 0
        ? []
        : (
            await selectRows(db, relatedTable, {
              filters: [
                {
                  column: relatedColumn,
                  operator: 'in',
                  value: localValues,
                },
              ],
              orFilters: [],
            })
          ).rows
    const selectedRelatedRows = await materializeSelection(
      db,
      relatedTable,
      relatedRows,
      selection.fields,
    )
    const relatedByValue = new Map<unknown, SelectedRow[]>()

    for (const related of selectedRelatedRows) {
      const value = related.source[relatedColumn]
      const matches = relatedByValue.get(value) ?? []
      matches.push(related)
      relatedByValue.set(value, matches)
    }

    selectedRows = selectedRows.filter((selectedRow) => {
      const matches = relatedByValue.get(selectedRow.source[localColumn]) ?? []
      const embedded = outbound ? (matches[0]?.result ?? null) : matches.map(({ result }) => result)
      selectedRow.result[selection.output] = embedded
      return !selection.inner || matches.length > 0
    })
  }

  return selectedRows
}

function projectColumns(
  row: Record<string, unknown>,
  selections: Selection[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const selection of selections) {
    if (selection.kind !== 'column') continue
    if (selection.source === '*') {
      Object.assign(result, row)
    } else {
      result[selection.output] = row[selection.source]
    }
  }

  return result
}

async function resolveRelationship(
  db: IDatabase,
  table: string,
  selection: RelationshipSelection,
): Promise<ForeignKeyRelationship> {
  if (!db.getForeignKeyRelationships) {
    throw new Error(
      `Database does not expose foreign-key metadata for embedded resource ${selection.selector}`,
    )
  }

  const relationships = await db.getForeignKeyRelationships(table)
  const hinted = selection.hint
    ? relationships.filter(
        (relationship) => selection.hint && relationshipMatches(relationship, selection.hint),
      )
    : relationships
  const candidates = hinted
    .map((relationship) => ({
      relationship,
      score: relationshipScore(relationship, table, selection.selector),
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)

  if (candidates.length === 0) {
    throw new Error(`No foreign-key relationship from ${table} matches ${selection.selector}`)
  }
  if (candidates.length > 1 && candidates[0]?.score === candidates[1]?.score) {
    throw new Error(`Foreign-key relationship from ${table} to ${selection.selector} is ambiguous`)
  }

  return candidates[0]?.relationship
}

function relationshipMatches(relationship: ForeignKeyRelationship, value: string): boolean {
  return (
    relationship.constraintName === value ||
    relationship.sourceColumn === value ||
    relationship.targetColumn === value ||
    relationship.sourceTable === value ||
    relationship.targetTable === value
  )
}

function relationshipScore(
  relationship: ForeignKeyRelationship,
  table: string,
  selector: string,
): number {
  if (relationship.constraintName === selector) return 5
  if (relationship.sourceTable === table && relationship.targetTable === selector) return 4
  if (relationship.targetTable === table && relationship.sourceTable === selector) return 4
  if (relationship.sourceTable === table && relationship.sourceColumn === selector) return 3
  if (relationship.targetTable === table && relationship.targetColumn === selector) return 3
  return 0
}

function parseSelect(rawSelect: string): Selection[] {
  return splitTopLevel(rawSelect)
    .map((rawPart): Selection => {
      const part = rawPart.trim()
      const openParen = part.indexOf('(')

      if (openParen === -1 || !part.endsWith(')')) {
        const colon = part.indexOf(':')
        return colon === -1
          ? { kind: 'column', source: part, output: part }
          : { kind: 'column', source: part.slice(colon + 1), output: part.slice(0, colon) }
      }

      const prefix = part.slice(0, openParen)
      const nested = part.slice(openParen + 1, -1)
      const colon = prefix.indexOf(':')
      const output = colon === -1 ? undefined : prefix.slice(0, colon)
      const relationWithModifiers = colon === -1 ? prefix : prefix.slice(colon + 1)
      const [selector = '', ...modifiers] = relationWithModifiers.split('!')

      return {
        kind: 'relationship',
        selector,
        hint: modifiers.find((modifier) => modifier !== 'inner'),
        output: output ?? selector,
        inner: modifiers.includes('inner'),
        fields: parseSelect(nested),
      }
    })
    .filter((selection) =>
      selection.kind === 'relationship'
        ? selection.selector.length > 0
        : selection.source.length > 0,
    )
}

function splitTopLevel(input: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    if (character === '(') depth += 1
    if (character === ')') depth -= 1
    if (character === ',' && depth === 0) {
      parts.push(input.slice(start, index))
      start = index + 1
    }
  }

  parts.push(input.slice(start))
  return parts
}

function acceptsSingularObject(accept?: string): boolean {
  if (!accept) return false

  return accept
    .split(',')
    .some(
      (mediaRange) => mediaRange.trim().split(';', 1)[0] === 'application/vnd.pgrst.object+json',
    )
}

function buildSingularResponse(
  rows: Record<string, unknown>[],
  accept?: string,
): SingularResponse | null {
  if (!acceptsSingularObject(accept)) return null

  if (rows.length !== 1) {
    return {
      status: 406,
      body: {
        code: 'PGRST116',
        details: `The result contains ${rows.length} rows`,
        hint: null,
        message: 'Cannot coerce the result to a single JSON object',
      },
    }
  }

  const first = rows[0]
  if (!first) return undefined
  return {
    body: first,
    contentType: 'application/vnd.pgrst.object+json',
  }
}

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

  const parts = headerValue
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
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
  const part0 = parts[0]
  const part1 = parts[1]
  if (!part0 || !part1) return null
  const from = parseInt(part0, 10)
  const to = parseInt(part1, 10)
  if (Number.isNaN(from) || Number.isNaN(to)) return null
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
      // The SDK URL-encodes the comma separator; URLSearchParams may
      // double-encode it, so we decode once more before parsing.
      const decoded = decodeURIComponent(rawValue)
      const groups = parseOrFilters(decoded)
      allOrGroups.push(...groups)
    }
  }

  return allOrGroups
}
