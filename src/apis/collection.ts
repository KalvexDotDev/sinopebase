/**
 * Collection CRUD API — /api/collections/*
 *
 * Port of PocketBase's apis/collection.go.
 * Superuser-only endpoints for managing collection schemas.
 * Layer 4 — imports from ~/core/*, ~/tools/*.
 */

import { Elysia } from 'elysia'
import { Collection } from '~/core/collection_model'
import type { IDatabase } from '~/core/db-interface'

import { selectRows } from './db-helpers'

// ---------------------------------------------------------------------------
// Internal helpers (avoid dependency on collection_query.ts MemoryDatabase mismatch)
// ---------------------------------------------------------------------------

async function queryAllCollections(db: IDatabase): Promise<Collection[]> {
  try {
    const result = await db.select('_collections', {})
    // Handle both MemoryDatabase format ({ rows, total }) and IDatabase format (Record[])
    const rows = selectRows(result)
    return rows.map((row: Record<string, unknown>) => {
      const collection = new Collection()
      collection.loadFromDb(row)
      return collection
    })
  } catch {
    return []
  }
}

async function queryCollectionById(db: IDatabase, id: string): Promise<Collection | null> {
  try {
    const result = await db.select('_collections', {
      filters: [{ column: 'id', operator: 'eq', value: id }],
    })
    const rows = selectRows(result)
    if (rows.length === 0) return null
    const first = rows[0]
    if (!first) return null
    const collection = new Collection()
    collection.loadFromDb(first)
    return collection
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * MemoryDatabase insert/update/delete take arrays where IDatabase takes single
 * records. This tiny interface captures the fallback signature so we can avoid
 * `as any` without changing the core IDatabase contract.
 */
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

/**
 * Create an Elysia plugin that registers all /api/collections/* routes.
 *
 * These endpoints require superuser authentication.
 */
export function createCollectionPlugin(db: IDatabase, isSuperuser: () => boolean) {
  const app = new Elysia({ name: 'sinopebase-collection' })

  // ── GET /api/collections — List all collections ──
  app.get('/api/collections', async ({ query, set }) => {
    if (!isSuperuser()) {
      set.status = 403
      return { code: 403, message: 'Only superusers can list collections.' }
    }

    try {
      const allCollections = await queryAllCollections(db)

      // Apply pagination from query
      const q = query as Record<string, string>
      const page = Math.max(1, parseInt(q.page ?? '1', 10) || 1)
      const perPage = Math.min(
        1000,
        Math.max(1, parseInt(q.perPage ?? q.per_page ?? '30', 10) || 30),
      )

      const totalItems = allCollections.length
      const totalPages = Math.ceil(totalItems / perPage)
      const start = (page - 1) * perPage
      const items = allCollections.slice(start, start + perPage).map((c) => c.toJSON())

      return {
        page,
        perPage,
        totalItems,
        totalPages,
        items,
      }
    } catch (err) {
      set.status = 400
      return {
        code: 400,
        message: `Failed to list collections: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })

  // ── POST /api/collections — Create a collection ──
  app.post('/api/collections', async ({ body, set }) => {
    if (!isSuperuser()) {
      set.status = 403
      return { code: 403, message: 'Only superusers can create collections.' }
    }

    try {
      const data = (body ?? {}) as Record<string, unknown>

      const name = String(data.name ?? '')
      if (!name) {
        set.status = 400
        return { code: 400, message: 'Collection name is required.' }
      }

      // Create the collection from the data
      const collection = new Collection()
      collection.loadFromJSON(data)

      if (!collection.hasId()) {
        collection.refreshId()
      }

      // Save to DB
      const serialized = collection.dbExport()
      serialized.id = collection.id

      try {
        await db.insert('_collections', serialized)
      } catch {
        // MemoryDatabase insert takes array
        await (db as unknown as MemoryAdapterFallback).insert('_collections', [serialized])
      }

      return collection.toJSON()
    } catch (err) {
      set.status = 400
      return {
        code: 400,
        message: `Failed to create collection: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })

  // ── GET /api/collections/:id — View a collection ──
  app.get('/api/collections/:id', async ({ params, set }) => {
    if (!isSuperuser()) {
      set.status = 403
      return { code: 403, message: 'Only superusers can view collections.' }
    }

    try {
      const collectionId = params.id as string
      const collection = await queryCollectionById(db, collectionId)

      if (!collection) {
        set.status = 404
        return { code: 404, message: 'Collection not found.' }
      }

      return collection.toJSON()
    } catch (err) {
      set.status = 400
      return {
        code: 400,
        message: `Failed to view collection: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })

  // ── PATCH /api/collections/:id — Update a collection ──
  app.patch('/api/collections/:id', async ({ params, body, set }) => {
    if (!isSuperuser()) {
      set.status = 403
      return { code: 403, message: 'Only superusers can update collections.' }
    }

    try {
      const collectionId = params.id as string
      const collection = await queryCollectionById(db, collectionId)

      if (!collection) {
        set.status = 404
        return { code: 404, message: 'Collection not found.' }
      }

      // Merge the submitted data into the existing collection
      const data = (body ?? {}) as Record<string, unknown>
      collection.loadFromJSON(data)

      // Save to DB
      const serialized = collection.dbExport()
      serialized.id = collection.id

      try {
        await db.update(
          '_collections',
          [{ column: 'id', operator: 'eq', value: collection.id }],
          serialized,
        )
      } catch {
        // MemoryDatabase update is synchronous
        ;(db as unknown as MemoryAdapterFallback).update(
          '_collections',
          [{ column: 'id', operator: 'eq', value: collection.id }],
          serialized,
        )
      }

      return collection.toJSON()
    } catch (err) {
      set.status = 400
      return {
        code: 400,
        message: `Failed to update collection: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })

  // ── DELETE /api/collections/:id — Delete a collection ──
  app.delete('/api/collections/:id', async ({ params, set }) => {
    if (!isSuperuser()) {
      set.status = 403
      return { code: 403, message: 'Only superusers can delete collections.' }
    }

    try {
      const collectionId = params.id as string
      const collection = await queryCollectionById(db, collectionId)

      if (!collection) {
        set.status = 404
        return { code: 404, message: 'Collection not found.' }
      }

      try {
        await db.delete('_collections', [{ column: 'id', operator: 'eq', value: collection.id }])
      } catch {
        ;(db as unknown as MemoryAdapterFallback).delete('_collections', [
          { column: 'id', operator: 'eq', value: collection.id },
        ])
      }

      set.status = 204
      return undefined
    } catch (err) {
      set.status = 400
      return {
        code: 400,
        message: `Failed to delete collection: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })

  return app
}
