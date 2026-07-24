/**
 * v0.23 upgrade migration 3 — adds auth_rule and manage_rule columns
 * to _collections for fine-grained auth record access control.
 *
 * Port of PocketBase's migrations/1717233558_v0.23_migrate3.go (Go -> TypeScript).
 * Layer 5 -- depends on ~/migrations/types.
 */

import type { MigrationDB } from './types.ts'

/**
 * Applies v0.23 schema changes part 3:
 * - Adds `auth_rule` column for record-level auth access control
 * - Adds `manage_rule` column for management-level auth access control
 */
export async function up(db: MigrationDB): Promise<void> {
  // auth_rule — rule evaluated when authenticating via this collection
  await db.raw(`
    ALTER TABLE _collections ADD COLUMN auth_rule TEXT
  `)

  // manage_rule — rule evaluated when managing auth records
  await db.raw(`
    ALTER TABLE _collections ADD COLUMN manage_rule TEXT
  `)
}

/**
 * Rolls back v0.23 schema changes part 3.
 */
export async function down(_db: MigrationDB): Promise<void> {
  // Columns remain after rollback (DROP COLUMN not universally supported).
}
