/**
 * Initial system tables migration — _collections, _params, _migrations.
 *
 * Port of PocketBase's migrations/1640988000_init.go (Go -> TypeScript).
 * Layer 5 -- depends on ~/migrations/types.
 */

import type { MigrationDB } from './types.ts'

/**
 * Creates the core system tables: _collections, _params, and _migrations.
 *
 * Equivalent to PocketBase's 1640988000_init migration.
 */
export async function up(db: MigrationDB): Promise<void> {
  // _migrations — tracks applied migrations
  await db.raw(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (now())
    )
  `)

  // _params — application settings key-value store
  await db.raw(`
    CREATE TABLE IF NOT EXISTS _params (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL DEFAULT '',
      created TEXT NOT NULL DEFAULT (now()),
      updated TEXT NOT NULL DEFAULT (now())
    )
  `)

  // _collections — schema definitions for all collections
  await db.raw(`
    CREATE TABLE IF NOT EXISTS _collections (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL DEFAULT 'base',
      schema TEXT NOT NULL DEFAULT '[]',
      indexes TEXT NOT NULL DEFAULT '[]',
      system TEXT NOT NULL DEFAULT '0',
      list_rule TEXT,
      view_rule TEXT,
      create_rule TEXT,
      update_rule TEXT,
      delete_rule TEXT,
      options TEXT NOT NULL DEFAULT '{}',
      created TEXT NOT NULL DEFAULT (now()),
      updated TEXT NOT NULL DEFAULT (now())
    )
  `)
}

/**
 * Drops the core system tables.
 */
export async function down(db: MigrationDB): Promise<void> {
  await db.raw('DROP TABLE IF EXISTS _collections')
  await db.raw('DROP TABLE IF EXISTS _params')
  await db.raw('DROP TABLE IF EXISTS _migrations')
}
