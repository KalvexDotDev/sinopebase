/**
 * SyncRecordTableSchema — add/remove/change columns based on field changes.
 *
 * Port of PocketBase's core/collection_record_table_sync.go (Go -> TypeScript).
 * Layer 2 — imports from ~/core/*, ~/tools/*.
 *
 * This is adapted from PocketBase's SQLite-focused implementation to a
 * PostgreSQL-compatible approach using the IDatabase interface.
 */

import {
  hasDatabaseSchemaCapability,
  type IDatabase,
  type SchemaDatabase,
} from '~/core/db-interface.ts'
import type { Collection } from '~/core/collection_model.ts'
import type { FieldsList } from '~/core/fields_list.ts'
import { PseudorandomString } from '~/tools/security/random.ts'

// ---------------------------------------------------------------------------
// SyncRecordTableSchema
// ---------------------------------------------------------------------------

/**
 * Compares two collections and applies the necessary record table schema changes.
 *
 * If `oldCollection` is null, only `newCollection` is used to create the table.
 *
 * Equivalent to PocketBase's `App.SyncRecordTableSchema()`.
 *
 * @param db - The database instance.
 * @param newCollection - The new/updated collection definition.
 * @param oldCollection - The previous collection definition (null for new collections).
 */
export async function syncRecordTableSchema(
  db: IDatabase,
  newCollection: Collection,
  oldCollection: Collection | null,
): Promise<void> {
  // View collections don't have their own record table
  if (newCollection.isView()) {
    return
  }

  if (!hasDatabaseSchemaCapability(db)) {
    throw new Error('Database does not support record-table schema mutations')
  }
  const schemaDb = db

  if (newCollection.indexes.length > 0 || (oldCollection?.indexes.length ?? 0) > 0) {
    throw new Error('Database does not support record-table index synchronization')
  }

  // -----------------------------------------------------------------------
  // CREATE - new collection
  // -----------------------------------------------------------------------
  if (!oldCollection) {
    await createRecordTable(schemaDb, newCollection)
    return
  }

  // -----------------------------------------------------------------------
  // UPDATE - existing collection
  // -----------------------------------------------------------------------
  const oldTableName = oldCollection.name
  const newTableName = newCollection.name

  const oldFields = oldCollection.fields
  const newFields = newCollection.fields

  // Check if indexes need updating
  const needsIndexUpdate =
    oldTableName.toLowerCase() !== newTableName.toLowerCase() ||
    !areFieldsEqual(oldFields, newFields) ||
    !areIndexArraysEqual(oldCollection.indexes, newCollection.indexes)

  // Drop old indexes if needed
  if (needsIndexUpdate) {
    // This is a simplified version - actual implementation would use SQL
    // to drop existing indexes
  }

  // Rename table if needed
  if (oldTableName.toLowerCase() !== newTableName.toLowerCase()) {
    throw new Error('Database does not support record-table renames')
  }

  // Check for deleted columns
  const allOldFields = oldFields.all()
  for (const oldField of allOldFields) {
    const exists = newFields.getById(oldField.id)
    if (exists) continue

    // Drop column
    await schemaDb.dropColumn(newTableName, oldField.name)
  }

  // Check for new or renamed columns
  const toRename: Array<{ temp: string; actual: string }> = []

  for (const field of newFields.all()) {
    const oldField = oldFields.getById(field.id)

    if (!oldField) {
      // New column - use temp name to avoid collisions
      const tempName = field.name + PseudorandomString(5)
      toRename.push({ temp: tempName, actual: field.name })

      await schemaDb.addColumn(newTableName, tempName, field.columnType)
    } else if (oldField.name !== field.name) {
      // Renamed column - use temp name first
      const tempName = field.name + PseudorandomString(5)
      toRename.push({ temp: tempName, actual: field.name })

      await schemaDb.renameColumn(newTableName, oldField.name, tempName)
    }
  }

  // Rename temp columns to actual names
  for (const { temp, actual } of toRename) {
    await schemaDb.renameColumn(newTableName, temp, actual)
  }

  // Handle single/multiple field type changes
  await normalizeSingleVsMultipleFieldChanges(schemaDb, newCollection, oldCollection)

  // Create new indexes
  if (needsIndexUpdate) {
    await createCollectionIndexes(schemaDb, newCollection)
  }
}

// ---------------------------------------------------------------------------
// CREATE table
// ---------------------------------------------------------------------------

/**
 * Creates a record table for a new collection.
 */
async function createRecordTable(
  db: SchemaDatabase,
  collection: Collection,
): Promise<void> {
  await db.createTable(collection.name)

  // Add columns for each field
  for (const field of collection.fields.all()) {
    await db.addColumn(collection.name, field.name, field.columnType)
  }

  // Create indexes
  await createCollectionIndexes(db, collection)
}

// ---------------------------------------------------------------------------
// Index management
// ---------------------------------------------------------------------------

/**
 * Creates indexes for a collection.
 *
 * Equivalent to PocketBase's `createCollectionIndexes()`.
 */
async function createCollectionIndexes(
  _db: SchemaDatabase,
  _collection: Collection,
): Promise<void> {
  // Non-empty index definitions are rejected before any schema mutation.
}

// ---------------------------------------------------------------------------
// Field type normalization
// ---------------------------------------------------------------------------

/**
 * Handles field type changes between single and multiple value modes.
 *
 * Equivalent to PocketBase's `normalizeSingleVsMultipleFieldChanges()`.
 */
async function normalizeSingleVsMultipleFieldChanges(
  _db: SchemaDatabase,
  _newCollection: Collection,
  _oldCollection: Collection,
): Promise<void> {
  // TODO: Implement field type normalization
  // When a field changes from single to multiple (or vice versa),
  // the column data needs to be converted:
  //
  // single -> multiple: wrap values in JSON arrays
  // multiple -> single: keep only the last element
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Normalizes the table name (lowercased, sanitized).
 */
export function normalizeTableName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_]/g, '_')
}

// ---------------------------------------------------------------------------
// Comparison helpers
// ---------------------------------------------------------------------------

function areFieldsEqual(
  a: FieldsList,
  b: FieldsList,
): boolean {
  const aArr = a.all()
  const bArr = b.all()

  if (aArr.length !== bArr.length) return false

  for (let i = 0; i < aArr.length; i++) {
    if (aArr[i]!.id !== bArr[i]!.id) return false
    if (aArr[i]!.name !== bArr[i]!.name) return false
    if (aArr[i]!.type !== bArr[i]!.type) return false
  }

  return true
}

function areIndexArraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false

  const sortedA = [...a].sort()
  const sortedB = [...b].sort()

  for (let i = 0; i < sortedA.length; i++) {
    if (sortedA[i] !== sortedB[i]) return false
  }

  return true
}
