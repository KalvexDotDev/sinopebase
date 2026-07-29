/**
 * Migration file loader — auto-discovers migration modules by naming convention.
 *
 * PocketBase pattern: migration files live in a known directory and are
 * named `<timestamp>_<name>.ts`. They are loaded and executed in timestamp
 * order at startup. Already-applied migrations are skipped by the runner.
 */

import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { MigrationDB } from '../../migrations/types'

/** Regex matching `<digits>_<snake-case-name>.ts` migration filenames. */
const MIGRATION_FILE_RE = /^(\d+)_([a-z0-9_]+)\.ts$/i

/** A migration module as exported by files in the migrations/ directory. */
interface MigrationModule {
  up: (db: MigrationDB) => Promise<void>
  down?: (db: MigrationDB) => Promise<void>
}

/** Resolved migration ready for the runner. */
export interface DiscoveredMigration {
  name: string
  up: (db: MigrationDB) => Promise<void>
  down?: (db: MigrationDB) => Promise<void>
}

/**
 * Discover and load migration modules from a directory.
 *
 * Scans `migrationsDir` for files matching `<timestamp>_<name>.ts`,
 * sorts by timestamp, and dynamically imports each module. Non-migration
 * files (types, tests, helpers) are silently skipped.
 */
export async function loadMigrationsFromDirectory(
  migrationsDir: string,
): Promise<DiscoveredMigration[]> {
  const migrations: DiscoveredMigration[] = []

  let entries: string[]
  try {
    entries = readdirSync(migrationsDir)
  } catch {
    // Directory doesn't exist — no migrations to load.
    return migrations
  }

  // Filter and sort by timestamp prefix
  const migrationFiles = entries
    .filter((name) => MIGRATION_FILE_RE.test(name))
    .sort((a, b) => {
      const ta = a.match(MIGRATION_FILE_RE)?.[1] ?? '0'
      const tb = b.match(MIGRATION_FILE_RE)?.[1] ?? '0'
      return ta.localeCompare(tb, 'en', { numeric: true })
    })

  for (const filename of migrationFiles) {
    const match = filename.match(MIGRATION_FILE_RE)
    if (!match) continue
    const migrationName = match[0].replace(/\.ts$/i, '')

    try {
      const filePath = resolve(migrationsDir, filename)
      // Dynamic import loads TypeScript modules at runtime (Bun transpiles on the fly).
      // nosemgrep: javascript-nosql-injection — file path from readdir, not user input
      const mod = (await import(filePath)) as MigrationModule

      if (typeof mod.up !== 'function') {
        // Skip files that don't export an `up` function (helpers, types, etc.)
        continue
      }

      migrations.push({
        name: migrationName,
        up: mod.up,
        down: mod.down,
      })
    } catch (err) {
      // Skip broken migration files — the app should still start so the
      // operator can fix them. The error is logged but not fatal.
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[migrations] Skipping "${filename}": ${message}`)
    }
  }

  return migrations
}
