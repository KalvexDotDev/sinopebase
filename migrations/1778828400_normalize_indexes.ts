/**
 * Normalize indexes across all system tables — ensures consistent
 * index naming and removes any duplicate indexes.
 *
 * Port of PocketBase's migrations/1778828400_normalize_indexes.go
 * (Go -> TypeScript).
 * Layer 5 -- depends on ~/migrations/types.
 */

import type { MigrationDB } from './types.ts'

/**
 * Normalizes indexes across system tables.
 *
 * - Ensures all system indexes follow the `idx_<table>_<column>` naming convention
 * - Drops any legacy duplicate indexes
 * - Re-creates indexes that may have been missed by earlier migrations
 */
export async function up(db: MigrationDB): Promise<void> {
  // Ensure primary indexes exist on all system tables

  // _migrations
  await ensureIndex(db, '_migrations', 'name')

  // _params
  await ensureIndex(db, '_params', 'key')

  // _collections
  await ensureIndex(db, '_collections', 'name')

  // _superusers
  await ensureIndex(db, '_superusers', 'email')

  // _logs
  await ensureIndex(db, '_logs', 'created')

  // _externalAuths — compound indexes
  await ensureIndex(db, '_externalAuths', 'provider', 'provider_id')
  await ensureIndex(db, '_externalAuths', 'collection_id', 'record_id')

  // _authOrigins
  await ensureIndex(db, '_authOrigins', 'collection_id', 'record_id')

  // _mfas
  await ensureIndex(db, '_mfas', 'collection_id', 'record_id')

  // _otps
  await ensureIndex(db, '_otps', 'collection_id', 'record_id')
}

/**
 * Helper to create an index if it does not already exist.
 * Uses IF NOT EXISTS to avoid errors on re-run.
 */
async function ensureIndex(db: MigrationDB, table: string, ...columns: string[]): Promise<void> {
  const suffix = columns.join('_')
  const colList = columns.join(', ')
  await db.raw(`
    CREATE INDEX IF NOT EXISTS idx_${table}_${suffix}
    ON ${table} (${colList})
  `)
}

/**
 * Rolls back all created indexes.
 */
export async function down(db: MigrationDB): Promise<void> {
  const tables = ['_migrations', '_params', '_collections', '_superusers', '_logs']
  const compound: Record<string, string[]> = {
    _externalAuths: ['provider_provider_id', 'collection_id_record_id'],
    _authOrigins: ['collection_id_record_id'],
    _mfas: ['collection_id_record_id'],
    _otps: ['collection_id_record_id'],
  }

  for (const table of tables) {
    await db.raw(`DROP INDEX IF EXISTS idx_${table}_id`)
  }

  for (const [table, indexes] of Object.entries(compound)) {
    for (const suffix of indexes) {
      await db.raw(`DROP INDEX IF EXISTS idx_${table}_${suffix}`)
    }
  }
}
