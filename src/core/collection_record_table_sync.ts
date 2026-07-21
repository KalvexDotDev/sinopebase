/**
 * SyncRecordTableSchema — add/remove/change columns based on field changes.
 *
 * Port of PocketBase's core/collection_record_table_sync.go (Go -> TypeScript).
 * Layer 2 — imports from ~/core/*, ~/tools/*.
 *
 * This is adapted from PocketBase's SQLite-focused implementation to a
 * PostgreSQL-compatible approach using the IDatabase interface.
 */

import type { IDatabase } from '~/core/db-interface.ts'
import type { Collection } from '~/core/collection_model.ts'
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

  // -----------------------------------------------------------------------
  // CREATE - new collection
  // -----------------------------------------------------------------------
  if (!oldCollection) {
    await createRecordTable(db, newCollection)
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
    // TODO: Implement table rename
    // await db.execute(`ALTER TABLE "${oldTableName}" RENAME TO "${newTableName}"`)
  }

  // Check for deleted columns
  const allOldFields = oldFields.toArray()
  for (const oldField of allOldFields) {
    const exists = newFields.getById(oldField.id)
    if (exists) continue

    // Drop column
    await db.dropColumn(newTableName, oldField.name)
  }

  // Check for new or renamed columns
  const toRename: Array<{ temp: string; actual: string }> = []

  for (const field of newFields) {
    const oldField = oldFields.getById(field.id)

    if (!oldField) {
      // New column - use temp name to avoid collisions
      const tempName = field.name + PseudorandomString(5)
      toRename.push({ temp: tempName, actual: field.name })

      await db.addColumn(newTableName, tempName, field.columnType)
    } else if (oldField.name !== field.name) {
      // Renamed column - use temp name first
      const tempName = field.name + PseudorandomString(5)
      toRename.push({ temp: tempName, actual: field.name })

      await db.renameColumn(newTableName, oldField.name, tempName)
    }
  }

  // Rename temp columns to actual names
  for (const { temp, actual } of toRename) {
    await db.renameColumn(newTableName, temp, actual)
  }

  // Handle single/multiple field type changes
  await normalizeSingleVsMultipleFieldChanges(db, newCollection, oldCollection)

  // Create new indexes
  if (needsIndexUpdate) {
    await createCollectionIndexes(db, newCollection)
  }
}

// ---------------------------------------------------------------------------
// CREATE table
// ---------------------------------------------------------------------------

/**
 * Creates a record table for a new collection.
 */
async function createRecordTable(
  db: IDatabase,
  collection: Collection,
): Promise<void> {
  await db.createTable(collection.name)

  // Add columns for each field
  for (const field of collection.fields) {
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
  _db: IDatabase,
  _collection: Collection,
): Promise<void> {
  // TODO: Implement index creation SQL
  // The actual implementation would parse each index expression
  // from collection.indexes and execute CREATE INDEX statements.
  // Example:
  //   CREATE UNIQUE INDEX IF NOT EXISTS idx_name ON table (column)
  // For now this is a stub since the IDatabase interface doesn't
  // have a generic query execution method.
}

/**
 * Drops all indexes for a collection.
 *
 * Equivalent to PocketBase's `dropCollectionIndexes()`.
 */
async function dropCollectionIndexes(
  _db: IDatabase,
  _collection: Collection,
): Promise<void> {
  // TODO: Implement index dropping
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
  _db: IDatabase,
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
// Extended IDatabase interface for schema operations
// ---------------------------------------------------------------------------

/**
 * Extended database operations needed for schema syncing.
 *
 * These are not part of the base IDatabase interface but are needed
 * for DDL operations.
 */
declare module '~/core/db-interface.ts' {
  interface IDatabase {
    /**
     * Adds a column to an existing table.
     */
    addColumn(table: string, column: string, columnType: string): Promise<void>

    /**
     * Drops a column from an existing table.
     */
    dropColumn(table: string, column: string): Promise<void>

    /**
     * Renames a column in an existing table.
     */
    renameColumn(table: string, oldName: string, newName: string): Promise<void>
  }
}

// ======================================================================
// NOTE: The DDL methods (addColumn, dropColumn, renameColumn) need to be
// implemented on the actual database classes. For now, they are declared
// here to support the type system. The concrete implementations would
// use ALTER TABLE statements:
//
//   ALTER TABLE table ADD COLUMN column type
//   ALTER TABLE table DROP COLUMN column
//   ALTER TABLE table RENAME COLUMN old TO new
// ======================================================================

// ---------------------------------------------------------------------------
// Comparison helpers
// ---------------------------------------------------------------------------

function areFieldsEqual(
  a: { toArray(): { id: string; name: string; type: string; columnType: string }[] },
  b: { toArray(): { id: string; name: string; type: string; columnType: string }[] },
): boolean {
  const aArr = a.toArray()
  const bArr = b.toArray()

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
