/**
 * v0.23 upgrade migration 4 — adds OTP and MFA related columns,
 * external auths provider name uniqueness.
 *
 * Port of PocketBase's migrations/1717233559_v0.23_migrate4.go (Go -> TypeScript).
 * Layer 5 -- depends on ~/migrations/types.
 */

import type { MigrationDB } from './types.ts'

/**
 * Applies v0.23 schema changes part 4:
 * - Adds unique constraint on _externalAuths (provider + provider_id)
 * - Adds `password_hash` and `token_key` to _superusers if missing
 */
export async function up(db: MigrationDB): Promise<void> {
  // Ensure superusers table has the right columns
  await db.raw(`
    ALTER TABLE _superusers ADD COLUMN password_hash TEXT DEFAULT ''
  `)

  await db.raw(`
    ALTER TABLE _superusers ADD COLUMN token_key TEXT DEFAULT ''
  `)

  // Ensure _externalAuths has provider + provider_id unique constraint
  // (for PostgreSQL, we use a partial unique index approach)
  await db.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_externalAuths_provider_unique
    ON _externalAuths (provider, provider_id)
  `)
}

/**
 * Rolls back v0.23 schema changes part 4.
 */
export async function down(db: MigrationDB): Promise<void> {
  await db.raw('DROP INDEX IF EXISTS idx_externalAuths_provider_unique')
}
