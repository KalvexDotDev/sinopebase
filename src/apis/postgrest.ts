/**
 * PostgREST Route Handlers
 *
 * Implements the PostgREST API at /rest/v1/:table
 * with support for SELECT, INSERT, UPDATE, DELETE, and HEAD operations.
 *
 * Mirrors PostgREST behavior:
 *   - Filter operators: eq, neq, gt, gte, lt, lte, like, ilike, is, in
 *   - Prefer header: count=exact, return=representation,
 *     resolution=merge-duplicates|ignore-duplicates (with on_conflict=)
 *   - Content-Range header for count
 *   - Range header for pagination
 */

import type { Elysia } from 'elysia'
import type { ForeignKeyRelationship, IDatabase, OrderBy } from '../core/db-interface'
import type { ParsedFilter } from '../core/db-memory'
import { PostgresDatabase, type PostgresRequestContext, RPC_IDENTIFIER } from '../core/db-postgres'
import { parseFilterParam, parseOrFilters } from '../tools/search/filter'
import { BadRequestError, InternalServerError } from './api_error_aliases'
import type { PostgresChange, PostgrestChangePublisher, PreparedRealtimeChange } from './realtime'

// ---------------------------------------------------------------------------
// Helper types
// ---------------------------------------------------------------------------

interface PreferOptions {
  count?: 'exact' | 'planned' | 'estimated'
  returnRepresentation?: boolean
  resolution?: string
  /** When count is 'planned' or 'estimated', include Content-Range header with estimate.
   *  PostgREST uses planned=exact, estimated=fast approximate. We treat both as header-only. */
  countHeader?: boolean
}

interface RangeInfo {
  from: number
  to: number
}

interface PostgrestSelectOptions {
  columns?: string[]
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

interface MutationResult {
  /** Full written rows, for realtime payloads. */
  rows: Record<string, unknown>[]
  /** Rows as the client asked for them (`select` projection and embeds). */
  body: Record<string, unknown>[]
}

interface ResponseState {
  status?: number | string
  headers: Record<string, string | number>
}

/** Thrown inside the request transaction so a singular mutation mismatch rolls back. */
class SingularCardinalityError extends Error {
  readonly rowCount: number
  constructor(rowCount: number) {
    super(`The result contains ${rowCount} rows`)
    this.rowCount = rowCount
  }
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
): Elysia {
  // -----------------------------------------------------------------------
  // GET — Select rows
  // -----------------------------------------------------------------------
  app.get('/rest/v1/:table', async ({ params, query, headers, request, set }) => {
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

    const select = query.select as string | undefined
    let result: { rows: Record<string, unknown>[]; total?: number }
    try {
      result = await withRequestDatabase(db, request, resolveContext, async (requestDb) => {
        const columns = select
          ? await selectionColumns(requestDb, table, parseSelect(select))
          : undefined
        const selectPage = async (window: { limit?: number; offset?: number }) => {
          const selected = await selectRows(requestDb, table, {
            columns,
            filters,
            orFilters,
            order,
            ...window,
          })
          return representation(requestDb, table, selected.rows, select)
        }
        const rows = await selectPage({ limit, offset })
        if (!prefer.count) return { rows }
        // PostgREST counts every matching row, ignoring limit/offset. An !inner
        // embed filters parent rows, so that count needs the embed evaluated.
        const total = select?.includes('!inner')
          ? (await selectPage({})).length
          : await countRows(requestDb, table, filters, orFilters)
        return { rows, total }
      })
    } catch (err) {
      return databaseErrorResponse(err, set, isAnonymous(request, resolveContext))
    }
    const { rows, total } = result

    set.headers['content-range'] = contentRange(offset ?? 0, rows.length, total)

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
  app.head('/rest/v1/:table', async ({ params, query, request, set }) => {
    const table = params.table as string

    // Parse filters
    const filters = parseFilters(query as Record<string, string>)
    const orFilters = parseOrQueryParams(query as Record<string, string>)

    const total = await withRequestDatabase(db, request, resolveContext, (requestDb) =>
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
  app.post('/rest/v1/:table', async ({ params, query, headers, body, request, set }) => {
    const table = params.table as string
    const prefer = parsePreferHeader(headers.prefer ?? headers.Prefer ?? '')
    const accept = headers.accept ?? headers.Accept

    // Body can be a single object or an array
    const rows = Array.isArray(body) ? body : [body]
    const sanitized = rows.map((r) =>
      typeof r === 'object' && r !== null ? (r as Record<string, unknown>) : {},
    )

    const upserting =
      prefer.resolution === 'merge-duplicates' || prefer.resolution === 'ignore-duplicates'
    const onConflict = parseOnConflict(query.on_conflict as string | undefined)
    if (onConflict === null) {
      set.status = 400
      return {
        code: 'PGRST100',
        message: 'on_conflict must be a comma-separated list of column names',
        details: null,
        hint: null,
      }
    }

    let result: MutationResult
    try {
      result = await withRequestDatabase(db, request, resolveContext, async (requestDb) => {
        const results: Record<string, unknown>[] = []
        for (const row of sanitized) {
          if (upserting) {
            // ignore-duplicates skips conflicting rows; PostgREST returns only inserted ones.
            const upserted = await requestDb.upsert(table, row, {
              onConflict,
              ignoreDuplicates: prefer.resolution === 'ignore-duplicates',
            })
            if (upserted) results.push(upserted)
          } else {
            results.push(await requestDb.insert(table, row))
          }
        }
        return mutationResult(requestDb, table, results, query.select, accept)
      })
    } catch (err) {
      return databaseErrorResponse(err, set, isAnonymous(request, resolveContext))
    }

    if (changes) {
      for (const row of result.rows) {
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
    return mutationResponse(result.body, accept, set)
  })

  // -----------------------------------------------------------------------
  // PATCH — Update rows
  // -----------------------------------------------------------------------
  app.patch('/rest/v1/:table', async ({ params, query, headers, body, request, set }) => {
    const table = params.table as string
    const accept = headers.accept ?? headers.Accept

    // Parse filters — include or filters for mutations (v0.6 compat)
    const filters = parseFilters(query as Record<string, string>)
    const orFilters = parseOrQueryParams(query as Record<string, string>)

    // Body is the data to update
    const data = (
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
    ) as Record<string, unknown>

    let result: MutationResult
    let previous: Record<string, unknown>[]
    try {
      ;({ result, previous } = await withRequestDatabase(
        db,
        request,
        resolveContext,
        async (requestDb) => {
          const previous = changes
            ? (await selectRows(requestDb, table, { filters, orFilters })).rows
            : []
          const updated = await requestDb.update(table, filters, data, orFilters)
          const result = await mutationResult(requestDb, table, updated, query.select, accept)
          return { result, previous }
        },
      ))
    } catch (err) {
      return databaseErrorResponse(err, set, isAnonymous(request, resolveContext))
    }

    if (changes) {
      for (const row of result.rows) {
        const old = previous.find((candidate) => candidate.id === row.id) ?? {}
        await changes.publishPostgresChange(postgresChange(table, 'UPDATE', row, old))
      }
    }

    return mutationResponse(result.body, accept, set)
  })

  // -----------------------------------------------------------------------
  // DELETE — Delete rows
  // -----------------------------------------------------------------------
  app.delete('/rest/v1/:table', async ({ params, query, headers, request, set }) => {
    const table = params.table as string
    const accept = headers.accept ?? headers.Accept

    // Parse filters — include or filters for mutations (v0.6 compat)
    const filters = parseFilters(query as Record<string, string>)
    const orFilters = parseOrQueryParams(query as Record<string, string>)

    let deleted: Record<string, unknown>[]
    let prepared: PreparedRealtimeChange[]
    try {
      ;({ deleted, prepared } = await withRequestDatabase(
        db,
        request,
        resolveContext,
        async (requestDb) => {
          const previous = changes
            ? (await selectRows(requestDb, table, { filters, orFilters })).rows
            : []
          const prepared: PreparedRealtimeChange[] = []
          if (changes) {
            for (const row of previous) {
              prepared.push(
                await changes.preparePostgresChange(postgresChange(table, 'DELETE', {}, row)),
              )
            }
          }
          const removed = await requestDb.delete(table, filters, orFilters)
          const { body } = await mutationResult(requestDb, table, removed, query.select, accept)
          return { deleted: body, prepared }
        },
      ))
    } catch (err) {
      return databaseErrorResponse(err, set, isAnonymous(request, resolveContext))
    }

    for (const delivery of prepared) delivery.deliver()

    // PostgREST returns the deleted rows (or empty array)
    return mutationResponse(deleted, accept, set)
  })

  // ── RPC — Execute PostgreSQL functions ──
  app.post('/rest/v1/rpc/:fn', async ({ params, body, request, set }) => {
    if (!db.rpc) {
      set.status = 501
      return { code: 501, message: 'RPC is only supported on PostgreSQL.' }
    }

    const fn = params.fn as string
    if (!fn || !RPC_IDENTIFIER.test(fn)) {
      set.status = 400
      return { code: 400, message: 'Invalid function name.' }
    }

    const input = (body ?? {}) as Record<string, unknown>
    if (typeof body === 'object' && body !== null) {
      for (const key of Object.keys(input)) {
        if (!RPC_IDENTIFIER.test(key)) {
          set.status = 400
          return { code: 400, message: `Invalid RPC argument name "${key}".` }
        }
      }
    }

    // Guarded by `if (!db.rpc)` above — rpc is always available here.
    // Call through the scoped request database so the method keeps `this`
    // (bound to the transaction connection carrying the RLS role).
    try {
      const rows = await withRequestDatabase(db, request, resolveContext, (requestDb) =>
        (requestDb.rpc as NonNullable<IDatabase['rpc']>)(fn, input),
      )
      return rows
    } catch (err) {
      const message = (err as Error).message
      // PostgreSQL function-not-found
      if (message.includes('function') && message.includes('does not exist')) {
        set.status = 404
        return { code: 404, message }
      }
      // PostgreSQL-raised errors (RAISE EXCEPTION, constraint violations, RLS
      // denials) — PostgREST parity: SQLSTATE status and body, not a masked 500.
      return databaseErrorResponse(err, set, isAnonymous(request, resolveContext))
    }
  })

  return app
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
  if (!context)
    throw new InternalServerError('PostgREST request reached the database without an auth context')

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
    columns: options.columns,
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
): Promise<number> {
  const filteredOrGroups = orFilters.filter((group) => group.length > 0)
  if (filteredOrGroups.length > 0) {
    // OR-filtered count requires a select pass (db.count only supports flat filters).
    const rows = await db.select(table, { columns: [], filters, orFilters: filteredOrGroups })
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

/** Fetch only requested fields and join keys; PostgreSQL still authorizes every column. */
async function selectionColumns(
  db: IDatabase,
  table: string,
  selections: Selection[],
  required: string[] = [],
): Promise<string[] | undefined> {
  const columns = new Set(required)
  for (const selection of selections) {
    if (selection.kind === 'column') {
      if (selection.source === '*') return undefined
      columns.add(selection.source)
    } else {
      const relationship = await resolveRelationship(db, table, selection)
      columns.add(
        relationship.sourceTable === table ? relationship.sourceColumn : relationship.targetColumn,
      )
    }
  }
  return [...columns]
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

    selectedRows = await embedRelationship(db, table, selectedRows, selection)
  }

  return selectedRows
}

async function embedRelationship(
  db: IDatabase,
  table: string,
  selectedRows: SelectedRow[],
  selection: RelationshipSelection,
): Promise<SelectedRow[]> {
  const relationship = await resolveRelationship(db, table, selection)
  const outbound = relationship.sourceTable === table
  const localColumn = outbound ? relationship.sourceColumn : relationship.targetColumn
  const relatedTable = outbound ? relationship.targetTable : relationship.sourceTable
  const relatedColumn = outbound ? relationship.targetColumn : relationship.sourceColumn
  const localValues = [
    ...new Set(
      selectedRows.map(({ source }) => source[localColumn]).filter((value) => value != null),
    ),
  ]

  const relatedRows = (
    await selectRows(db, relatedTable, {
      columns: await selectionColumns(db, relatedTable, selection.fields, [relatedColumn]),
      filters: [{ column: relatedColumn, operator: 'in', value: localValues }],
      orFilters: [],
    })
  ).rows
  const selectedRelatedRows = await materializeSelection(
    db,
    relatedTable,
    relatedRows,
    selection.fields,
  )
  const relatedByValue = groupRelatedRows(selectedRelatedRows, relatedColumn)

  return selectedRows.filter((selectedRow) => {
    const matches = relatedByValue.get(selectedRow.source[localColumn]) ?? []
    const embedded = outbound ? (matches[0]?.result ?? null) : matches.map(({ result }) => result)
    selectedRow.result[selection.output] = embedded
    return !selection.inner || matches.length > 0
  })
}

function groupRelatedRows(selectedRelatedRows: SelectedRow[], relatedColumn: string) {
  const relatedByValue = new Map<unknown, SelectedRow[]>()

  for (const related of selectedRelatedRows) {
    const value = related.source[relatedColumn]
    const matches = relatedByValue.get(value) ?? []
    matches.push(related)
    relatedByValue.set(value, matches)
  }

  return relatedByValue
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
    throw new InternalServerError(
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
    // A bad embed selector is a request error (PostgREST: PGRST204), not a 500.
    throw new BadRequestError(
      `No foreign-key relationship from ${table} matches ${selection.selector}`,
    )
  }
  if (candidates.length > 1 && candidates[0]?.score === candidates[1]?.score) {
    throw new BadRequestError(
      `Foreign-key relationship from ${table} to ${selection.selector} is ambiguous`,
    )
  }

  return candidates[0]!.relationship
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

/** Apply the `select` projection and embeds the GET path uses to rows already read or written. */
async function representation(
  db: IDatabase,
  table: string,
  rows: Record<string, unknown>[],
  select: string | undefined,
): Promise<Record<string, unknown>[]> {
  return select ? applySelection(db, table, rows, select) : rows
}

/**
 * Shape mutation rows inside the request transaction, so RLS applies to the
 * embeds and a failed `.single()` cardinality check rolls the write back
 * (PostgREST checks it before commit).
 */
async function mutationResult(
  db: IDatabase,
  table: string,
  rows: Record<string, unknown>[],
  select: string | undefined,
  accept: string | undefined,
): Promise<MutationResult> {
  if (acceptsSingularObject(accept) && rows.length !== 1) {
    throw new SingularCardinalityError(rows.length)
  }
  return { rows, body: await representation(db, table, rows, select) }
}

function mutationResponse(
  rows: Record<string, unknown>[],
  accept: string | undefined,
  set: ResponseState,
): Record<string, unknown> | Record<string, unknown>[] {
  const singular = buildSingularResponse(rows, accept)
  if (!singular) return rows
  if (singular.status) set.status = singular.status
  if (singular.contentType) set.headers['content-type'] = singular.contentType
  return singular.body
}

function isAnonymous(
  request: Request,
  resolveContext: PostgrestContextResolver | undefined,
): boolean {
  return resolveContext?.(request)?.role === 'anon'
}

/** PostgREST Content-Range: `start-end/total`, `*` for an empty page or an uncounted total. */
function contentRange(start: number, rowCount: number, total?: number): string {
  const range = rowCount > 0 ? `${start}-${start + rowCount - 1}` : '*'
  return `${range}/${total ?? '*'}`
}

/** `on_conflict=a,b` → ['a', 'b']; null when a name is not a plain identifier. */
function parseOnConflict(raw: string | undefined): string[] | undefined | null {
  if (!raw) return undefined
  const columns = raw.split(',').map((column) => column.trim())
  return columns.every((column) => RPC_IDENTIFIER.test(column)) ? columns : null
}

const SQLSTATE = /^[0-9A-Z]{5}$/

const SQLSTATE_STATUS: Record<string, number> = {
  '23503': 409,
  '23505': 409,
  '25006': 405,
  '42883': 404,
  '42P01': 404,
  '42P17': 500,
  '53400': 500,
  P0001: 400,
}

const SQLSTATE_CLASS_STATUS: Record<string, number> = {
  '08': 503,
  '09': 500,
  '0L': 403,
  '0P': 403,
  '25': 500,
  '28': 403,
  '2D': 500,
  '38': 500,
  '39': 500,
  '3B': 500,
  '40': 500,
  '53': 503,
  '54': 500,
  '55': 500,
  '57': 500,
  '58': 500,
  F0: 500,
  HV: 500,
  P0: 500,
  XX: 500,
}

/** PostgREST's SQLSTATE → HTTP table (postgrest.org references/errors). */
function sqlStateStatus(code: string, anonymous: boolean): number {
  if (code === '42501') return anonymous ? 401 : 403
  return SQLSTATE_STATUS[code] ?? SQLSTATE_CLASS_STATUS[code.slice(0, 2)] ?? 400
}

/**
 * Map a PostgreSQL error to PostgREST's status and `{code, message, details,
 * hint}` body. Anything that is not a database error is rethrown so the
 * global handler masks it as a 500.
 */
function databaseErrorResponse(
  err: unknown,
  set: ResponseState,
  anonymous: boolean,
): Record<string, unknown> {
  if (err instanceof SingularCardinalityError) {
    set.status = 406
    return singularCardinalityBody(err.rowCount)
  }
  const pg = err as { code?: unknown; message?: unknown; severity?: unknown }
  if (
    err instanceof Error &&
    typeof pg.code === 'string' &&
    SQLSTATE.test(pg.code) &&
    typeof pg.severity === 'string'
  ) {
    const { detail, hint } = err as { detail?: string; hint?: string }
    set.status = sqlStateStatus(pg.code, anonymous)
    return { code: pg.code, message: err.message, details: detail ?? null, hint: hint ?? null }
  }
  throw err
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

  if (rows.length !== 1) return { status: 406, body: singularCardinalityBody(rows.length) }

  const first = rows[0]
  if (!first) return null
  return {
    body: first,
    contentType: 'application/vnd.pgrst.object+json',
  }
}

function singularCardinalityBody(rowCount: number): Record<string, unknown> {
  return {
    code: 'PGRST116',
    details: `The result contains ${rowCount} rows`,
    hint: null,
    message: 'Cannot coerce the result to a single JSON object',
  }
}

/**
 * Parse the Prefer header into structured options.
 *
 * Prefer header format (per RFC 7240):
 *   Prefer: count=exact
 *   Prefer: return=representation
 *   Prefer: resolution=merge-duplicates | resolution=ignore-duplicates
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
          if (value === 'planned' || value === 'estimated') {
            options.countHeader = true
          }
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
      // Elysia already decoded the query value once (tolerantly). A strict
      // second decode throws URIError on wildcard patterns like %foo%, so
      // decode tolerantly and fall back to the raw value on failure.
      let decoded = rawValue
      try {
        decoded = decodeURIComponent(rawValue)
      } catch {
        // Already decoded — use as-is.
      }
      const groups = parseOrFilters(decoded)
      allOrGroups.push(...groups)
    }
  }

  return allOrGroups
}
