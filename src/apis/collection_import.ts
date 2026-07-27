/**
 * Collection import API — POST /api/collections/import
 *
 * Port of PocketBase's apis/collection_import.go.
 * Bulk import/merge collections from JSON data.
 * Layer 4 — imports from ~/core/*.
 */

import { Elysia } from 'elysia'
import { Collection } from '~/core/collection_model'
import type { IDatabase } from '~/core/db-interface'
import { selectRows } from './db-helpers'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MemoryAdapterFallback {
  insert(table: string, records: Record<string, unknown>[]): Promise<unknown>
}

interface CollectionsImportBody {
  collections: Record<string, unknown>[]
  deleteMissing: boolean
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * Create an Elysia plugin that registers the /api/collections/import endpoint.
 *
 * Superuser-only. Accepts a JSON body with `collections` array and optional
 * `deleteMissing` boolean.
 */
export function createCollectionImportPlugin(db: IDatabase, isSuperuser: () => boolean) {
  const app = new Elysia()

  app.post('/api/collections/import', async ({ body, set }) => {
    if (!isSuperuser()) {
      set.status = 403
      return { code: 403, message: 'Only superusers can import collections.' }
    }

    try {
      const data = (body ?? {}) as Partial<CollectionsImportBody>

      if (!Array.isArray(data.collections) || data.collections.length === 0) {
        set.status = 400
        return { code: 400, message: 'collections array is required and must not be empty.' }
      }

      // Import each collection: upsert by id or name
      const errors: string[] = []

      for (const colData of data.collections) {
        try {
          const name = String(colData.name ?? '')
          const id = String(colData.id ?? '')

          if (!name && !id) {
            errors.push(`Skipped collection with no name or id`)
            continue
          }

          const collection = new Collection()
          collection.loadFromJSON(colData)

          if (!collection.hasId()) {
            collection.refreshId()
          }

          const serialized = collection.dbExport()
          serialized.id = collection.id

          // Try to update existing, or insert new
          try {
            const existing = await db.select('_collections', {
              filters: [{ column: 'id', operator: 'eq', value: collection.id }],
            })
            const existingRows = selectRows(existing)
            if (existingRows.length > 0) {
              await db.update(
                '_collections',
                [{ column: 'id', operator: 'eq', value: collection.id }],
                serialized,
              )
            } else {
              try {
                await db.insert('_collections', serialized)
              } catch {
                await (db as unknown as MemoryAdapterFallback).insert('_collections', [serialized])
              }
            }
          } catch {
            try {
              await db.insert('_collections', serialized)
            } catch {
              await (db as unknown as MemoryAdapterFallback).insert('_collections', [serialized])
            }
          }
        } catch (colErr) {
          errors.push(
            `Error importing collection: ${colErr instanceof Error ? colErr.message : String(colErr)}`,
          )
        }
      }

      // Handle deleteMissing
      if (data.deleteMissing && data.collections.length > 0) {
        try {
          const importedNames = new Set(data.collections.map((c) => String(c.name ?? '')))
          const result = await db.select('_collections', {})
          const allRows = selectRows(result)
          for (const row of allRows) {
            const name = String(row.name ?? '')
            if (name && !importedNames.has(name) && row.system !== true) {
              try {
                await db.delete('_collections', [
                  { column: 'id', operator: 'eq', value: String(row.id) },
                ])
              } catch {
                // ignore delete errors
              }
            }
          }
        } catch {
          // ignore list errors during deleteMissing
        }
      }

      if (errors.length > 0) {
        set.status = 400
        return { code: 400, message: 'Import completed with errors.', data: errors }
      }

      set.status = 204
      return undefined
    } catch (err) {
      set.status = 400
      return {
        code: 400,
        message: `Failed to import collections: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })

  return app
}
