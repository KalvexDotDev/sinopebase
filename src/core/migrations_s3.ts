/**
 * S3 Migration Loader — loads .sql migration files from an S3-compatible bucket.
 *
 * Mirrors loadSqlMigrationsFromDirectory() in migrations_loader.ts but reads
 * from an S3 bucket instead of the local filesystem.
 *
 * Used by Railway template users who deploy a prebuilt image and cannot add
 * local SQL files to supabase/migrations/. They upload timestamped .sql files
 * to a migration bucket and the server applies them at startup.
 */

import type { S3FileStore } from '~/tools/filesystem/store-s3'
import type { MigrationDB } from '../../migrations/types'

/** Regex matching `<digits>_<snake-case-name>.sql` migration filenames. */
const SQL_MIGRATION_FILE_RE = /^(\d+)_([a-z0-9_]+)\.sql$/i

/** Resolved migration ready for the runner. */
export interface DiscoveredMigration {
  name: string
  up: (db: MigrationDB) => Promise<void>
  down?: (db: MigrationDB) => Promise<void>
}

/**
 * Discover and load raw SQL migration files from an S3-compatible bucket.
 *
 * Lists objects in `bucket` with an optional prefix, filters to files matching
 * `<timestamp>_<name>.sql`, sorts by timestamp, downloads each file, and wraps
 * the SQL as a migration. Already-applied migrations are skipped by the runner.
 */
export async function loadSqlMigrationsFromS3(
  store: S3FileStore,
  bucket: string,
  prefix?: string,
): Promise<DiscoveredMigration[]> {
  const migrations: DiscoveredMigration[] = []

  let objects: { name: string }[]
  try {
    objects = await store.list(bucket, prefix ?? '')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[migrations] Could not list S3 bucket "${bucket}": ${message}`)
    return migrations
  }

  // Filter and sort by timestamp prefix
  const sqlFiles = objects
    .map((obj) => {
      // Extract just the filename from the full key
      const segments = obj.name.split('/')
      const filename = segments[segments.length - 1] ?? obj.name
      return { key: obj.name, filename }
    })
    .filter(({ filename }) => {
      const match = filename.match(SQL_MIGRATION_FILE_RE)
      return match !== null
    })
    .sort((a, b) => {
      const ta = a.filename.match(SQL_MIGRATION_FILE_RE)?.[1] ?? '0'
      const tb = b.filename.match(SQL_MIGRATION_FILE_RE)?.[1] ?? '0'
      return ta.localeCompare(tb, 'en', { numeric: true })
    })

  for (const { key, filename } of sqlFiles) {
    const match = filename.match(SQL_MIGRATION_FILE_RE)
    if (!match) continue
    const migrationName = filename.replace(/\.sql$/i, '')

    try {
      const sql = await store.read(bucket, key)

      if (!sql || sql.trim().length === 0) {
        console.warn(`[migrations] Skipping empty SQL file "${filename}" from S3`)
        continue
      }

      migrations.push({
        name: migrationName,
        up: async (db: MigrationDB) => {
          const text =
            typeof sql === 'string' ? sql : Buffer.from(sql as ArrayBuffer).toString('utf-8')
          await db.raw(text)
        },
        // SQL files have no rollback — down is undefined.
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[migrations] Skipping S3 object "${key}": ${message}`)
    }
  }

  return migrations
}
