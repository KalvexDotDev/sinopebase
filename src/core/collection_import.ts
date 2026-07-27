/**
 * Import collections from JSON — merge strategy for bulk collection definitions.
 *
 * Port of PocketBase's core/collection_import.go (Go -> TypeScript).
 * Layer 2 — imports from ~/core/*.
 */

import { Collection } from '~/core/collection_model.ts'
import type { IDatabase } from '~/core/db-interface.ts'

// ---------------------------------------------------------------------------
// ImportCollections
// ---------------------------------------------------------------------------

/**
 * Imports collections from an array of JSON data.
 *
 * Uses a merge strategy:
 *  - Existing collections are updated (matched by id or name).
 *  - New collections are created.
 *  - If `deleteMissing` is true, collections not in the import set are removed.
 *
 * Equivalent to PocketBase's `App.ImportCollections()`.
 *
 * @param db - The database instance.
 * @param toImport - Array of collection JSON data.
 * @param deleteMissing - Whether to delete collections not present in the import.
 * @returns A map of collection id -> errors, if any.
 */
export async function importCollections(
  db: IDatabase,
  toImport: Record<string, unknown>[],
  deleteMissing: boolean = false,
): Promise<Record<string, Record<string, string[]>> | null> {
  if (toImport.length === 0) {
    throw new Error('no collections to import')
  }

  // Import collections one by one
  const allErrors: Record<string, Record<string, string[]>> = {}
  const importedIds = new Set<string>()

  for (const data of toImport) {
    // Resolve the collection identifier
    const idOrName = String(data.id ?? data.name ?? '')

    // Check if this collection already exists
    const { findCollectionByNameOrId } = await import('~/core/collection_query.ts')
    const existing = await findCollectionByNameOrId(db, idOrName)

    let collection: Collection

    if (existing) {
      // Update existing collection
      collection = existing
      collection.loadFromJSON(data)

      if (deleteMissing) {
        // Preserve system fields from the existing collection
        for (const field of existing.fields) {
          if (field.system && !collection.fields.getByName(field.name)) {
            collection.fields.add(field)
          }
        }
      }
    } else {
      // Create new collection
      collection = new Collection()
      collection.loadFromJSON(data)
    }

    // Store for later
    importedIds.add(collection.id)

    // Save the collection
    try {
      // We save via a helper that persists to DB
      await saveCollectionToDb(db, collection)
    } catch (err) {
      allErrors[collection.id] = {
        _general: [err instanceof Error ? err.message : String(err)],
      }
    }
  }

  // Delete missing collections if requested
  if (deleteMissing) {
    const { findAllCollections } = await import('~/core/collection_query.ts')
    const allExisting = await findAllCollections(db)

    for (const existing of allExisting) {
      if (existing.system) continue // never delete system collections
      if (!importedIds.has(existing.id)) {
        try {
          await deleteCollectionFromDb(db, existing)
        } catch (err) {
          allErrors[existing.id] = {
            _general: [err instanceof Error ? err.message : String(err)],
          }
        }
      }
    }
  }

  return Object.keys(allErrors).length > 0 ? allErrors : null
}

/**
 * Imports collections from a marshaled JSON string.
 *
 * Equivalent to PocketBase's `App.ImportCollectionsByMarshaledJSON()`.
 */
export async function importCollectionsByMarshaledJSON(
  db: IDatabase,
  json: string,
  deleteMissing: boolean = false,
): Promise<Record<string, Record<string, string[]>> | null> {
  const data = JSON.parse(json) as Record<string, unknown>[]
  return importCollections(db, data, deleteMissing)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Saves a collection to the database.
 */
async function saveCollectionToDb(_db: IDatabase, _collection: Collection): Promise<void> {
  // TODO: Implement actual persistence with validation
  // 1. Validate the collection
  // 2. Sync record table schema
  // 3. Upsert into _collections table
  // This is a stub for now
}

/**
 * Deletes a collection from the database.
 */
async function deleteCollectionFromDb(_db: IDatabase, _collection: Collection): Promise<void> {
  // TODO: Implement actual deletion
  // 1. Drop the record table
  // 2. Remove from _collections table
  // This is a stub for now
}
