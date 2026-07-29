/**
 * Auto-migration runner — compares file migrations vs applied migrations
 * table, runs pending ones.
 *
 * Port of PocketBase's plugins/migratecmd/automigrate.go (Go -> TypeScript).
 * Layer 5 -- imports from ~/core/*, ~/migrations/*.
 */

import type { MigrationDB, Migration } from '../../migrations/types.ts'
import type { IDatabase } from '~/core/db-interface.ts'

/**
 * Ensures the _migrations tracking table exists.
 */
async function ensureMigrationsTable(db: IDatabase): Promise<void> {
  if (!(await db.hasTable('_migrations'))) {
    await db.createTable('_migrations')
  }
}

/**
 * Loads the set of already-applied migration names from the database.
 */
async function loadAppliedMigrationNames(db: IDatabase): Promise<Set<string>> {
  await ensureMigrationsTable(db)
  const rows = await db.select('_migrations', { filters: [] })
  return new Set(rows.map((r) => String(r['name'])).filter(Boolean))
}

/**
 * Records a migration as applied in the tracking table.
 */
async function recordMigration(db: IDatabase, name: string): Promise<void> {
  await db.insert('_migrations', {
    name,
    applied_at: new Date().toISOString(),
  })
}

/**
 * Removes a migration record from the tracking table (for rollback).
 */
async function removeMigration(db: IDatabase, name: string): Promise<void> {
  await db.delete('_migrations', [{ column: 'name', operator: 'eq', value: name }])
}

/**
 * Runs all pending migrations.
 *
 * Compares the list of file-based migrations against the _migrations
 * table and executes any that haven't been applied yet.
 *
 * @param db - The standard IDatabase for tracking.
 * @param migrationDb - The MigrationDB for raw SQL execution.
 * @param migrations - The ordered list of available migrations.
 * @returns The number of migrations applied.
 */
export async function runPendingMigrations(
  db: IDatabase,
  migrationDb: MigrationDB,
  migrations: Migration[],
): Promise<number> {
  const applied = await loadAppliedMigrationNames(db)
  let count = 0

  for (const migration of migrations) {
    if (applied.has(migration.name)) {
      continue
    }

    console.log(`[migrate] Applying: ${migration.name}`)
    await migration.up(migrationDb)
    await recordMigration(db, migration.name)
    applied.add(migration.name)
    count++
  }

  if (count === 0) {
    console.log('[migrate] No pending migrations')
  } else {
    console.log(`[migrate] Applied ${count} migration(s)`)
  }

  return count
}

/**
 * Rolls back the last N migrations.
 *
 * @param db - The standard IDatabase for tracking.
 * @param migrationDb - The MigrationDB for raw SQL execution.
 * @param migrations - The ordered list of available migrations.
 * @param steps - Number of migrations to roll back (default: 1).
 * @returns The number of migrations rolled back.
 */
export async function rollbackMigrations(
  db: IDatabase,
  migrationDb: MigrationDB,
  migrations: Migration[],
  steps: number = 1,
): Promise<number> {
  const applied = await loadAppliedMigrationNames(db)
  let count = 0

  // Roll back in reverse order
  for (let i = migrations.length - 1; i >= 0 && count < steps; i--) {
    const migration = migrations[i]!
    if (!applied.has(migration.name)) {
      continue
    }
    if (!migration.down) {
      console.log(`[migrate] No rollback for: ${migration.name}, skipping`)
      count++
      continue
    }

    console.log(`[migrate] Rolling back: ${migration.name}`)
    await migration.down(migrationDb)
    await removeMigration(db, migration.name)
    count++
  }

  console.log(`[migrate] Rolled back ${count} migration(s)`)
  return count
}
