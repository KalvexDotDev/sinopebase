/**
 * Record DB operations — find, filter, and authenticate records.
 *
 * Port of PocketBase's core/record_query.go (Go -> TypeScript).
 * Layer 2 — imports from ~/core/*, ~/tools/*.
 */

import type { IDatabase, Filter } from '~/core/db-interface.ts'
import type { Collection } from '~/core/collection_model.ts'
import { Record as RecordModel } from '~/core/record_model.ts'
import { ParseJWT } from '~/tools/security/jwt.ts'

// ---------------------------------------------------------------------------
// Record Query Functions
// ---------------------------------------------------------------------------

/**
 * Finds a single record by its id within the specified collection.
 *
 * Equivalent to PocketBase's `App.FindRecordById()`.
 */
export async function findRecordById(
  db: IDatabase,
  collection: Collection | string,
  recordId: string,
): Promise<RecordModel | null> {
  const tableName = typeof collection === 'string' ? collection : collection.name

  const rows = await db.select(tableName, {
    filters: [{ column: 'id', operator: 'eq', value: recordId }],
    limit: 1,
  })

  if (rows.length === 0) return null

  const col = typeof collection === 'string'
    ? { name: collection, fields: { getByName: () => undefined, [Symbol.iterator]: function* () {} } } as unknown as Collection
    : collection

  return rowToRecord(col, rows[0]!)
}

/**
 * Finds records by their ids.
 *
 * Equivalent to PocketBase's `App.FindRecordsByIds()`.
 */
export async function findRecordsByIds(
  db: IDatabase,
  collection: Collection | string,
  recordIds: string[],
): Promise<RecordModel[]> {
  if (recordIds.length === 0) return []
  const tableName = typeof collection === 'string' ? collection : collection.name

  const rows = await db.select(tableName, {
    filters: [{ column: 'id', operator: 'in', value: recordIds }],
  })

  const col = typeof collection === 'string'
    ? { name: collection, fields: { getByName: () => undefined, [Symbol.iterator]: function* () {} } } as unknown as Collection
    : collection

  return rows.map((row) => rowToRecord(col, row))
}

/**
 * Finds all records in a collection, optionally filtered.
 *
 * Equivalent to PocketBase's `App.FindAllRecords()`.
 */
export async function findAllRecords(
  db: IDatabase,
  collection: Collection | string,
  ...filters: Filter[]
): Promise<RecordModel[]> {
  const tableName = typeof collection === 'string' ? collection : collection.name

  const rows = await db.select(tableName, { filters })

  const col = typeof collection === 'string'
    ? { name: collection, fields: { getByName: () => undefined, [Symbol.iterator]: function* () {} } } as unknown as Collection
    : collection

  return rows.map((row) => rowToRecord(col, row))
}

/**
 * Finds the first record matching the given key-value pair.
 *
 * Equivalent to PocketBase's `App.FindFirstRecordByData()`.
 */
export async function findFirstRecordByData(
  db: IDatabase,
  collection: Collection | string,
  key: string,
  value: unknown,
): Promise<RecordModel | null> {
  const tableName = typeof collection === 'string' ? collection : collection.name

  const rows = await db.select(tableName, {
    filters: [{ column: key, operator: 'eq', value }],
    limit: 1,
  })

  if (rows.length === 0) return null

  const col = typeof collection === 'string'
    ? { name: collection, fields: { getByName: () => undefined, [Symbol.iterator]: function* () {} } } as unknown as Collection
    : collection

  return rowToRecord(col, rows[0]!)
}

/**
 * Finds records by a filter string with sorting and pagination.
 *
 * Equivalent to PocketBase's `App.FindRecordsByFilter()`.
 */
export async function findRecordsByFilter(
  db: IDatabase,
  collection: Collection | string,
  filter: string,
  _sort?: string,
  limit?: number,
  offset?: number,
): Promise<RecordModel[]> {
  const tableName = typeof collection === 'string' ? collection : collection.name
  const col = typeof collection === 'string'
    ? { name: collection, fields: { getByName: () => undefined, [Symbol.iterator]: function* () {} } } as unknown as Collection
    : collection

  // Parse the filter string into Filters
  const filters = parseFilterString(filter)

  const rows = await db.select(tableName, {
    filters,
    limit,
    offset,
  })

  return rows.map((row) => rowToRecord(col, row))
}

/**
 * Finds the first record matching the filter string.
 *
 * Equivalent to PocketBase's `App.FindFirstRecordByFilter()`.
 */
export async function findFirstRecordByFilter(
  db: IDatabase,
  collection: Collection | string,
  filter: string,
  sort?: string,
): Promise<RecordModel | null> {
  const results = await findRecordsByFilter(db, collection, filter, sort, 1, 0)
  return results[0] ?? null
}

/**
 * Counts records in a collection, optionally filtered.
 *
 * Equivalent to PocketBase's `App.CountRecords()`.
 */
export async function countRecords(
  db: IDatabase,
  collection: Collection | string,
  ...filters: Filter[]
): Promise<number> {
  const tableName = typeof collection === 'string' ? collection : collection.name
  return db.count(tableName, filters)
}

/**
 * Finds an auth record by validating a JWT token.
 *
 * Equivalent to PocketBase's `App.FindAuthRecordByToken()`.
 */
export async function findAuthRecordByToken(
  db: IDatabase,
  token: string,
  tokenSecret: string,
): Promise<RecordModel | null> {
  try {
    const claims = await ParseJWT(token, tokenSecret)

    const id = claims['id'] as string | undefined
    const collectionId = claims['collectionId'] as string | undefined

    if (!id || !collectionId) return null

    // Find the collection first
    const { findCollectionByNameOrId } = await import('~/core/collection_query.ts')
    const collection = await findCollectionByNameOrId(db, collectionId)
    if (!collection || !collection.isAuth()) return null

    return findRecordById(db, collection, id)
  } catch {
    return null
  }
}

/**
 * Finds an auth record by email.
 *
 * Equivalent to PocketBase's `App.FindAuthRecordByEmail()`.
 */
export async function findAuthRecordByEmail(
  db: IDatabase,
  collection: Collection | string,
  email: string,
): Promise<RecordModel | null> {
  return findFirstRecordByData(db, collection, 'email', email)
}

/**
 * Checks if a record can be accessed based on the provided rule.
 *
 * Equivalent to PocketBase's `App.CanAccessRecord()`.
 */
export async function canAccessRecord(
  _db: IDatabase,
  _record: RecordModel,
  _rule: string | null,
): Promise<boolean> {
  // null rule = no access
  if (_rule === null) return false

  // Empty rule = public access
  if (_rule === '') return true

  // TODO: Implement rule evaluation using the filter/rule system
  // For now, just return true (allow access) as a stub
  return true
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Converts a database row to a Record instance.
 */
function rowToRecord(collection: Collection, row: Record<string, unknown>): RecordModel {
  const record = new RecordModel(collection)

  // Set the id
  record.id = String(row['id'] ?? '')

  // Set data from row
  for (const [key, value] of Object.entries(row)) {
    if (key === 'id') continue
    record.setRaw(key, value)
  }

  return record
}

/**
 * Parses a PocketBase-style filter string into Filter objects.
 *
 * Supports basic operators: =, !=, >, >=, <, <=, ~, !~
 *
 * @example
 *   "email = 'test@example.com' && status = 'active'"
 */
function parseFilterString(filter: string): Filter[] {
  if (!filter || filter.trim() === '') return []

  const filters: Filter[] = []
  const parts = filter.split('&&')

  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue

    // Try to match operator patterns
    const match = trimmed.match(
      /^(\w+)\s*(!=|>=|<=|=|~|!~|>|<)\s*(.+)$/,
    )
    if (match) {
      const [, column, op, rawValue] = match
      const value = rawValue.trim().replace(/^['"]|['"]$/g, '')

      const operatorMap: Record<string, string> = {
        '=': 'eq',
        '!=': 'neq',
        '>': 'gt',
        '>=': 'gte',
        '<': 'lt',
        '<=': 'lte',
        '~': 'like',
        '!~': 'not',
      }

      filters.push({
        column: column!,
        operator: operatorMap[op!] ?? 'eq',
        value,
      })
    }
  }

  return filters
}
