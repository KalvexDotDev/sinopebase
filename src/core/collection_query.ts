/**
 * Collection DB operations — find, list, and reference collections.
 *
 * Port of PocketBase's core/collection_query.go (Go -> TypeScript).
 * Layer 2 — imports from ~/core/* and ~/tools/*.
 */

import type { IDatabase } from '~/core/db-interface.ts'
import { Collection, FieldsListFromJSON, type CollectionType } from '~/core/collection_model.ts'
import { CollectionAuthOptions } from '~/core/collection_model_auth_options.ts'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Store key for cached collections. */
export const StoreKeyCachedCollections = 'pbAppCachedCollections'

// ---------------------------------------------------------------------------
// Collection Query Functions
// ---------------------------------------------------------------------------

/**
 * Finds all collections, optionally filtered by type(s).
 *
 * Equivalent to PocketBase's `App.FindAllCollections()`.
 */
export async function findAllCollections(
  db: IDatabase,
  ...collectionTypes: CollectionType[]
): Promise<Collection[]> {
  const filters = collectionTypes.length > 0
    ? [{ column: 'type', operator: 'in' as const, value: [...new Set(collectionTypes)] }]
    : []

  const rows = await db.select('_collections', { filters })
  return rows.map(rowToCollection)
}

/**
 * Finds a single collection by name or id.
 *
 * Equivalent to PocketBase's `App.FindCollectionByNameOrId()`.
 */
export async function findCollectionByNameOrId(
  db: IDatabase,
  nameOrId: string,
): Promise<Collection | null> {
  const rows = await db.select('_collections', {
    filters: [
      {
        column: 'id',
        operator: 'eq',
        value: nameOrId,
      },
    ],
  })

  if (rows.length > 0) return rowToCollection(rows[0]!)

  // Try by name (case-insensitive)
  const rowsByName = await db.select('_collections', {
    filters: [
      {
        column: 'name',
        operator: 'ilike',
        value: nameOrId,
      },
    ],
  })

  if (rowsByName.length > 0) return rowToCollection(rowsByName[0]!)

  return null
}

/**
 * Finds a collection from cache, falling back to DB lookup.
 *
 * Equivalent to PocketBase's `App.FindCachedCollectionByNameOrId()`.
 */
export async function findCachedCollectionByNameOrId(
  db: IDatabase,
  cachedCollections: Collection[] | null,
  nameOrId: string,
): Promise<Collection | null> {
  // Try cache first
  if (cachedCollections) {
    const cached = cachedCollections.find(
      (c) => c.id === nameOrId || c.name.toLowerCase() === nameOrId.toLowerCase(),
    )
    if (cached) return cached
  }

  // Fall back to DB
  return findCollectionByNameOrId(db, nameOrId)
}

/**
 * Finds collections that reference the given collection via relation fields.
 *
 * Equivalent to PocketBase's `App.FindCollectionReferences()`.
 */
export async function findCollectionReferences(
  db: IDatabase,
  collection: Collection,
  ...excludeIds: string[]
): Promise<Map<Collection, string[]>> {
  const allCollections = await findAllCollections(db)
  const excludeSet = new Set(excludeIds)
  const result = new Map<Collection, string[]>()

  for (const c of allCollections) {
    if (excludeSet.has(c.id)) continue

    const refFieldNames: string[] = []
    for (const field of c.fields) {
      if (field.type === 'relation') {
        const relField = field as Record<string, unknown>
        if (String(relField.collectionId) === collection.id) {
          refFieldNames.push(field.name)
        }
      }
    }

    if (refFieldNames.length > 0) {
      result.set(c, refFieldNames)
    }
  }

  return result
}

/**
 * Finds cached collection references.
 *
 * Equivalent to PocketBase's `App.FindCachedCollectionReferences()`.
 */
export async function findCachedCollectionReferences(
  cachedCollections: Collection[] | null,
  collection: Collection,
  ...excludeIds: string[]
): Promise<Map<Collection, string[]>> {
  const result = new Map<Collection, string[]>()
  const excludeSet = new Set(excludeIds)

  if (!cachedCollections) return result

  for (const c of cachedCollections) {
    if (excludeSet.has(c.id)) continue

    const refFieldNames: string[] = []
    for (const field of c.fields) {
      if (field.type === 'relation') {
        const relField = field as Record<string, unknown>
        if (String(relField.collectionId) === collection.id) {
          refFieldNames.push(field.name)
        }
      }
    }

    if (refFieldNames.length > 0) {
      result.set(c, refFieldNames)
    }
  }

  return result
}

/**
 * Checks if a collection name is unique (case-insensitive).
 *
 * Equivalent to PocketBase's `App.IsCollectionNameUnique()`.
 */
export async function isCollectionNameUnique(
  db: IDatabase,
  name: string,
  ...excludeIds: string[]
): Promise<boolean> {
  if (!name) return false

  const count = await db.count('_collections', [
    { column: 'name', operator: 'ilike', value: name },
    ...(excludeIds.length > 0
      ? [{ column: 'id', operator: 'in' as const, value: excludeIds }]
      : []),
  ])

  return count === 0
}

// ---------------------------------------------------------------------------
// Internal helper: convert a DB row to a Collection instance
// ---------------------------------------------------------------------------

/**
 * Converts a database row (Record<string, unknown>) to a Collection instance.
 */
function rowToCollection(row: Record<string, unknown>): Collection {
  const collection = new Collection()

  collection.id = String(row.id ?? '')
  collection.name = String(row.name ?? '')
  collection.type = (row.type as CollectionType) ?? 'base'
  collection.system = Boolean(row.system)

  collection.listRule = row.listRule != null ? String(row.listRule) : null
  collection.viewRule = row.viewRule != null ? String(row.viewRule) : null
  collection.createRule = row.createRule != null ? String(row.createRule) : null
  collection.updateRule = row.updateRule != null ? String(row.updateRule) : null
  collection.deleteRule = row.deleteRule != null ? String(row.deleteRule) : null

  // Parse indexes
  if (typeof row.indexes === 'string') {
    try { collection.indexes = JSON.parse(row.indexes) } catch { collection.indexes = [] }
  }

  // Parse fields
  if (typeof row.fields === 'string') {
    try {
      const parsedFields = JSON.parse(row.fields) as Record<string, unknown>[]
      collection.fields = FieldsListFromJSON(parsedFields)
    } catch {
      // ignore
    }
  }

  // Parse options
  if (typeof row.options === 'string' && row.options) {
    try {
      const opts = JSON.parse(row.options) as Record<string, unknown>
      collection.rawOptions = opts
      if (collection.isAuth()) {
        collection.authOptions = CollectionAuthOptions.fromJSON(opts)
      }
    } catch {
      // ignore parse errors
    }
  }

  return collection
}
