/**
 * Record CRUD API — /api/collections/:collection/records/*
 *
 * Port of PocketBase's apis/record_crud.go.
 * Full CRUD with filter, sort, pagination, expand, and access rule enforcement.
 * Layer 4 — imports from ~/core/*, ~/tools/*, ~/forms/*.
 */

import { Elysia } from 'elysia'
import { Collection } from '~/core/collection_model'
import type { IDatabase } from '~/core/db-interface'
import { Record as RecordModel } from '~/core/record_model'
import {
  checkRecordAccess,
  enrichRecord,
  parseExpands,
  parsePagination,
  type RequestAuthInfo,
} from './record_helpers'

// ---------------------------------------------------------------------------
// Internal helpers (handle both IDatabase and MemoryDatabase formats)
// ---------------------------------------------------------------------------

import type { SelectOptions } from '~/core/db-interface'
import { selectRows as unwrapRows } from './db-helpers'

function firstRow<T>(rows: T[]): T | null {
  return rows[0] ?? null
}

async function selectRows(
  db: IDatabase,
  table: string,
  options: SelectOptions = {},
): Promise<Record<string, unknown>[]> {
  try {
    const result = await db.select(table, options)
    return unwrapRows(result)
  } catch {
    return []
  }
}

async function findCollectionByIdOrName(
  db: IDatabase,
  idOrName: string,
): Promise<Collection | null> {
  const rows = await selectRows(db, '_collections', {
    filters: [{ column: 'id', operator: 'eq', value: idOrName }],
    limit: 1,
  })
  const first = firstRow(rows)
  if (first) {
    const collection = new Collection()
    collection.loadFromDb(first)
    return collection
  }

  const nameRows = await selectRows(db, '_collections', {
    filters: [{ column: 'name', operator: 'ilike', value: idOrName }],
    limit: 1,
  })
  const nameFirst = firstRow(nameRows)
  if (nameFirst) {
    const collection = new Collection()
    collection.loadFromDb(nameFirst)
    return collection
  }
  return null
}

async function findRecord(
  db: IDatabase,
  collection: Collection,
  recordId: string,
): Promise<RecordModel | null> {
  const rows = await selectRows(db, collection.name, {
    filters: [{ column: 'id', operator: 'eq', value: recordId }],
    limit: 1,
  })
  const first = firstRow(rows)
  if (!first) return null
  const record = new RecordModel(collection)
  record.load(first)
  if (first.id) record.id = String(first.id)
  return record
}

async function listAllRecords(db: IDatabase, collection: Collection): Promise<RecordModel[]> {
  const rows = await selectRows(db, collection.name, {})
  return rows.map((row) => {
    const record = new RecordModel(collection)
    record.load(row)
    if (row.id) record.id = String(row.id)
    return record
  })
}

interface MemoryAdapterFallback {
  insert(table: string, records: Record<string, unknown>[]): Promise<unknown>
  update(
    table: string,
    filters: { column: string; operator: string; value: unknown }[],
    data: Record<string, unknown>,
  ): Promise<unknown>
  delete(
    table: string,
    filters: { column: string; operator: string; value: unknown }[],
  ): Promise<unknown>
}

async function insertRecord(
  db: IDatabase,
  collection: Collection,
  serialized: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(collection.name, serialized)
  } catch {
    await (db as IDatabase & MemoryAdapterFallback).insert(collection.name, [serialized])
  }
}

async function updateRecord(
  db: IDatabase,
  collection: Collection,
  recordId: string,
  serialized: Record<string, unknown>,
): Promise<void> {
  serialized.id = recordId
  try {
    await db.update(
      collection.name,
      [{ column: 'id', operator: 'eq', value: recordId }],
      serialized,
    )
  } catch {
    ;(db as IDatabase & MemoryAdapterFallback).update(
      collection.name,
      [{ column: 'id', operator: 'eq', value: recordId }],
      serialized,
    )
  }
}

async function deleteRecord(
  db: IDatabase,
  collection: Collection,
  recordId: string,
): Promise<void> {
  try {
    await db.delete(collection.name, [{ column: 'id', operator: 'eq', value: recordId }])
  } catch {
    ;(db as IDatabase & MemoryAdapterFallback).delete(collection.name, [
      { column: 'id', operator: 'eq', value: recordId },
    ])
  }
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * Create an Elysia plugin that registers all /api/collections/:collection/records/* routes.
 */
export function createRecordCrudPlugin(
  db: IDatabase,
  authResolver: () => Promise<RequestAuthInfo>,
) {
  const app = new Elysia({ name: 'sinopebase-record-crud' })

  // ── GET /api/collections/:collection/records — List records ──
  app.get('/api/collections/:collection/records', async ({ params, query, set }) => {
    const collectionParam = params.collection as string

    const collection = await findCollectionByIdOrName(db, collectionParam)
    if (!collection) {
      set.status = 404
      return { code: 404, message: 'Collection not found.' }
    }

    const authInfo = await authResolver()

    const hasAccess = await checkRecordAccess(
      db,
      null as unknown as RecordModel,
      collection.listRule,
      authInfo,
    )
    if (!hasAccess) {
      set.status = 403
      return { code: 403, message: 'You do not have permission to list records.' }
    }

    try {
      const q = query as Record<string, string | undefined>
      const pagination = parsePagination(q)
      const expands = parseExpands(q)

      const allRecords = await listAllRecords(db, collection)

      const totalItems = pagination.skipTotal ? 0 : allRecords.length
      const totalPages = pagination.skipTotal ? 0 : Math.ceil(totalItems / pagination.perPage)
      const start = (pagination.page - 1) * pagination.perPage
      const pageItems = allRecords.slice(start, start + pagination.perPage)

      for (const record of pageItems) {
        await enrichRecord(db, record, expands)
      }

      return {
        page: pagination.page,
        perPage: pagination.perPage,
        totalItems,
        totalPages,
        items: pageItems.map((r) => r.toJSON()),
      }
    } catch (err) {
      set.status = 400
      return {
        code: 400,
        message: `Failed to list records: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })

  // ── POST /api/collections/:collection/records — Create record ──
  app.post('/api/collections/:collection/records', async ({ params, body, set }) => {
    const collectionParam = params.collection as string

    const collection = await findCollectionByIdOrName(db, collectionParam)
    if (!collection) {
      set.status = 404
      return { code: 404, message: 'Collection not found.' }
    }

    const authInfo = await authResolver()

    const hasAccess = await checkRecordAccess(
      db,
      null as unknown as RecordModel,
      collection.createRule,
      authInfo,
    )
    if (!hasAccess) {
      set.status = 403
      return { code: 403, message: 'You do not have permission to create records.' }
    }

    try {
      const data = (body ?? {}) as Record<string, unknown>

      const record = new RecordModel(collection)
      record.load(data)

      if (!record.hasId()) {
        record.refreshId()
      }

      const serialized = record.dbExport()
      serialized.id = record.id

      await insertRecord(db, collection, serialized)

      set.status = 201
      return record.toJSON()
    } catch (err) {
      set.status = 400
      return {
        code: 400,
        message: `Failed to create record: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })

  // ── GET /api/collections/:collection/records/:id — View record ──
  app.get('/api/collections/:collection/records/:id', async ({ params, query, set }) => {
    const collectionParam = params.collection as string
    const recordId = params.id as string

    const collection = await findCollectionByIdOrName(db, collectionParam)
    if (!collection) {
      set.status = 404
      return { code: 404, message: 'Collection not found.' }
    }

    const authInfo = await authResolver()

    try {
      const record = await findRecord(db, collection, recordId)
      if (!record) {
        set.status = 404
        return { code: 404, message: 'Record not found.' }
      }

      const hasAccess = await checkRecordAccess(db, record, collection.viewRule, authInfo)
      if (!hasAccess) {
        set.status = 403
        return { code: 403, message: 'You do not have permission to view this record.' }
      }

      const q = query as Record<string, string | undefined>
      const expands = parseExpands(q)
      await enrichRecord(db, record, expands)

      return record.toJSON()
    } catch (err) {
      set.status = 400
      return {
        code: 400,
        message: `Failed to view record: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })

  // ── PATCH /api/collections/:collection/records/:id — Update record ──
  app.patch('/api/collections/:collection/records/:id', async ({ params, body, set }) => {
    const collectionParam = params.collection as string
    const recordId = params.id as string

    const collection = await findCollectionByIdOrName(db, collectionParam)
    if (!collection) {
      set.status = 404
      return { code: 404, message: 'Collection not found.' }
    }

    const authInfo = await authResolver()

    try {
      const record = await findRecord(db, collection, recordId)
      if (!record) {
        set.status = 404
        return { code: 404, message: 'Record not found.' }
      }

      const hasAccess = await checkRecordAccess(db, record, collection.updateRule, authInfo)
      if (!hasAccess) {
        set.status = 403
        return { code: 403, message: 'You do not have permission to update this record.' }
      }

      const data = (body ?? {}) as Record<string, unknown>
      record.load(data)

      const serialized = record.dbExport()
      await updateRecord(db, collection, recordId, serialized)

      return record.toJSON()
    } catch (err) {
      set.status = 400
      return {
        code: 400,
        message: `Failed to update record: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })

  // ── DELETE /api/collections/:collection/records/:id — Delete record ──
  app.delete('/api/collections/:collection/records/:id', async ({ params, set }) => {
    const collectionParam = params.collection as string
    const recordId = params.id as string

    const collection = await findCollectionByIdOrName(db, collectionParam)
    if (!collection) {
      set.status = 404
      return { code: 404, message: 'Collection not found.' }
    }

    const authInfo = await authResolver()

    try {
      const record = await findRecord(db, collection, recordId)
      if (!record) {
        set.status = 404
        return { code: 404, message: 'Record not found.' }
      }

      const hasAccess = await checkRecordAccess(db, record, collection.deleteRule, authInfo)
      if (!hasAccess) {
        set.status = 403
        return { code: 403, message: 'You do not have permission to delete this record.' }
      }

      await deleteRecord(db, collection, recordId)

      set.status = 204
      return undefined
    } catch (err) {
      set.status = 400
      return {
        code: 400,
        message: `Failed to delete record: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })

  return app
}
