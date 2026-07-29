/**
 * Migration definitions — lists of system and app migrations.
 *
 * Port of PocketBase's migrations (Go -> TypeScript).
 *
 * Migrations are applied in order during application bootstrap
 * and are tracked in a `_migrations` table.
 */

import type { MigrationDB } from '../../migrations/types'

/**
 * A single migration definition.
 */
export interface Migration {
  /** Unique migration name/identifier. */
  name: string

  /** The apply function that runs the migration. */
  up: (db: MigrationDB) => Promise<void>

  /** Optional rollback function. */
  down?: (db: MigrationDB) => Promise<void>
}

/**
 * List of system migrations for Sinopebase core tables.
 *
 * These run before app migrations to ensure the core schema exists.
 */
export const SystemMigrations: Migration[] = [
  {
    name: '20240101_init_core',
    up: async () => {
      // Create core system tables
      // This is handled by the database bootstrap process
    },
  },
]

/**
 * List of application-specific migrations.
 *
 * Users add their own migrations here or register them dynamically.
 */
export const AppMigrations: Migration[] = []
