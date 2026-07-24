/**
 * v0.23 upgrade migration 2 — adds _collections options schema validation,
 * view query support, and list_options fields.
 *
 * Port of PocketBase's migrations/1717233557_v0.23_migrate2.go (Go -> TypeScript).
 * Layer 5 -- depends on ~/migrations/types.
 */

import type { MigrationDB } from './types.ts'

/**
 * Applies v0.23 schema changes part 2:
 * - Adds `view_query` column to _collections for view-type collections
 * - Adds `list_options` for per-collection list API configuration
 */
export async function up(db: MigrationDB): Promise<void> {
  // view_query — SQL query used by view-type collections
  await db.raw(`
    ALTER TABLE _collections ADD COLUMN view_query TEXT DEFAULT ''
  `)

  // list_options — JSON configuration for list API behavior
  await db.raw(`
    ALTER TABLE _collections ADD COLUMN list_options TEXT NOT NULL DEFAULT '{}'
  `)
}

/**
 * Rolls back v0.23 schema changes part 2.
 */
export async function down(_db: MigrationDB): Promise<void> {
  // Columns remain after rollback (DROP COLUMN not universally supported).
}
