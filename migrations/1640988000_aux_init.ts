/**
 * Auxiliary tables migration — _superusers, _logs, _externalAuths, etc.
 *
 * Port of PocketBase's migrations/1640988000_aux_init.go (Go -> TypeScript).
 * Layer 5 -- depends on ~/migrations/types.
 */

import type { MigrationDB } from './types.ts'

/**
 * Creates auxiliary system tables: _superusers, _logs, _externalAuths,
 * _authOrigins, _mfas, _otps, and related indexes.
 *
 * Equivalent to PocketBase's 1640988000_aux_init migration.
 */
export async function up(db: MigrationDB): Promise<void> {
  // _superusers — admin/superuser accounts
  await db.raw(`
    CREATE TABLE IF NOT EXISTS _superusers (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL DEFAULT '',
      token_key TEXT NOT NULL DEFAULT '',
      created TEXT NOT NULL DEFAULT (datetime('now')),
      updated TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  // _logs — request and application logs
  await db.raw(`
    CREATE TABLE IF NOT EXISTS _logs (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      level INTEGER NOT NULL DEFAULT 0,
      message TEXT NOT NULL DEFAULT '',
      data TEXT NOT NULL DEFAULT '{}',
      created TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  // _externalAuths — OAuth2 external provider links
  await db.raw(`
    CREATE TABLE IF NOT EXISTS _externalAuths (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      collection_id TEXT NOT NULL,
      record_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      created TEXT NOT NULL DEFAULT (datetime('now')),
      updated TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  // _authOrigins — known auth origins for alerting
  await db.raw(`
    CREATE TABLE IF NOT EXISTS _authOrigins (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      collection_id TEXT NOT NULL,
      record_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      created TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  // _mfas — multi-factor authentication records
  await db.raw(`
    CREATE TABLE IF NOT EXISTS _mfas (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      collection_id TEXT NOT NULL,
      record_id TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT '',
      value TEXT NOT NULL DEFAULT '',
      verified TEXT NOT NULL DEFAULT (datetime('now')),
      created TEXT NOT NULL DEFAULT (datetime('now')),
      updated TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  // _otps — one-time passwords
  await db.raw(`
    CREATE TABLE IF NOT EXISTS _otps (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      collection_id TEXT NOT NULL,
      record_id TEXT NOT NULL,
      password TEXT NOT NULL DEFAULT '',
      attempts INTEGER NOT NULL DEFAULT 0,
      created TEXT NOT NULL DEFAULT (datetime('now')),
      updated TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  // Indexes
  await db.raw(`
    CREATE INDEX IF NOT EXISTS idx_externalAuths_provider
    ON _externalAuths (provider, provider_id)
  `)
  await db.raw(`
    CREATE INDEX IF NOT EXISTS idx_externalAuths_record
    ON _externalAuths (collection_id, record_id)
  `)
  await db.raw(`
    CREATE INDEX IF NOT EXISTS idx_authOrigins_record
    ON _authOrigins (collection_id, record_id)
  `)
  await db.raw(`
    CREATE INDEX IF NOT EXISTS idx_mfas_record
    ON _mfas (collection_id, record_id)
  `)
  await db.raw(`
    CREATE INDEX IF NOT EXISTS idx_otps_record
    ON _otps (collection_id, record_id)
  `)
  await db.raw(`
    CREATE INDEX IF NOT EXISTS idx_logs_created
    ON _logs (created)
  `)
}

/**
 * Drops all auxiliary system tables.
 */
export async function down(db: MigrationDB): Promise<void> {
  await db.raw('DROP TABLE IF EXISTS _superusers')
  await db.raw('DROP TABLE IF EXISTS _logs')
  await db.raw('DROP TABLE IF EXISTS _externalAuths')
  await db.raw('DROP TABLE IF EXISTS _authOrigins')
  await db.raw('DROP TABLE IF EXISTS _mfas')
  await db.raw('DROP TABLE IF EXISTS _otps')
}
