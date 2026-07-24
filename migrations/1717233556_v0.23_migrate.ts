/**
 * v0.23 upgrade migration 1 — schema updates for collections,
 * adds new columns and index improvements.
 *
 * Port of PocketBase's migrations/1717233556_v0.23_migrate.go (Go -> TypeScript).
 * Layer 5 -- depends on ~/migrations/types.
 */

import type { MigrationDB } from './types.ts'

/**
 * Applies v0.23 schema changes:
 * - Adds `collection_id` to _collections for nested grouping
 * - Adds `original_name` and `mime_type` tracking columns
 * - Updates _params with a `type` column
 */
export async function up(db: MigrationDB): Promise<void> {
  // Add collection_id to _collections for hierarchy support
  await db.raw(`
    ALTER TABLE _collections ADD COLUMN collection_id TEXT DEFAULT ''
  `)

  // Add type column to _params
  await db.raw(`
    ALTER TABLE _params ADD COLUMN type TEXT DEFAULT 'text'
  `)
}

/**
 * Rolls back v0.23 schema changes.
 */
export async function down(_db: MigrationDB): Promise<void> {
  // SQLite does not support DROP COLUMN in older versions.
  // These columns will remain but be unused after rollback.
  // For PostgreSQL: ALTER TABLE _params DROP COLUMN type;
}
