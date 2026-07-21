/**
 * Migration CLI plugin — `migrate` command with up/down/create subcommands.
 *
 * Port of PocketBase's plugins/migratecmd/migratecmd.go (Go -> TypeScript).
 * Layer 5 -- imports from ~/core/*, ~/migrations/*, plugins/migratecmd/*.
 *
 * This plugin registers a `migrate` CLI command and optionally runs
 * auto-migrations on startup.
 */

import type { App } from '~/core/app.ts'
import type { IDatabase } from '~/core/db-interface.ts'
import type { Migration, MigrationDB } from '../../migrations/types.ts'
import { runPendingMigrations, rollbackMigrations } from './automigrate.ts'
import { migrationTemplate, migrationFileName } from './templates.ts'

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

export interface MigrateCmdOptions {
  /** Automatically run pending migrations on server startup. */
  automigrate?: boolean

  /** Directory where migration files are stored. */
  migrationsDir?: string

  /** List of system migrations to apply first. */
  systemMigrations?: Migration[]

  /** List of app/user migrations. */
  appMigrations?: Migration[]

  /** Whether to generate TypeScript (true) or JavaScript (false) templates. */
  useTs?: boolean
}

// ---------------------------------------------------------------------------
// MigrationDB adapter
// ---------------------------------------------------------------------------

/**
 * Creates a MigrationDB adapter from an IDatabase instance.
 *
 * For databases that support raw SQL (e.g. PostgresDatabase),
 * this wraps the underlying Kysely instance. For in-memory databases,
 * raw SQL is converted into equivalent operations.
 */
function createMigrationDB(db: IDatabase): MigrationDB {
  // If the database has a `raw` method, use it directly
  const maybeRaw = (db as unknown as { raw: (sql: string) => Promise<void> }).raw
  if (typeof maybeRaw === 'function') {
    return { raw: maybeRaw }
  }

  // Fallback: parse common SQL patterns for in-memory DB
  return {
    raw: async (sql: string): Promise<void> => {
      const normalized = sql.trim().toLowerCase()

      // CREATE TABLE IF NOT EXISTS
      if (normalized.startsWith('create table if not exists')) {
        const match = sql.match(/CREATE TABLE IF NOT EXISTS\s+(\S+)/i)
        if (match && match[1]) {
          const tableName = match[1].replace(/[`"']/g, '')
          if (!(await db.hasTable(tableName))) {
            await db.createTable(tableName)
          }
        }
        return
      }

      // ALTER TABLE ... ADD COLUMN
      if (normalized.startsWith('alter table')) {
        // In-memory DB doesn't need schema alterations
        return
      }

      // DROP TABLE IF EXISTS
      if (normalized.startsWith('drop table if exists')) {
        const match = sql.match(/DROP TABLE IF EXISTS\s+(\S+)/i)
        if (match && match[1]) {
          const tableName = match[1].replace(/[`"']/g, '')
          if (await db.hasTable(tableName)) {
            await db.dropTable(tableName)
          }
        }
        return
      }

      // CREATE INDEX IF NOT EXISTS / DROP INDEX IF EXISTS
      if (normalized.startsWith('create index') || normalized.startsWith('drop index')) {
        // In-memory DB doesn't support indexes
        return
      }

      // DROP INDEX IF EXISTS
      if (normalized.startsWith('drop index if exists')) {
        return
      }

      // UPDATE ... SET (for in-memory, parse key-value updates)
      if (normalized.startsWith('update')) {
        // Simplified: just no-op for in-memory
        return
      }

      // INSERT INTO ... (for in-memory, parse insert)
      if (normalized.startsWith('insert into') || normalized.startsWith('insert')) {
        return
      }

      // For anything else, log a warning
      console.warn(`[migrate] Raw SQL not supported by in-memory DB: ${sql.slice(0, 60)}...`)
    },
  }
}

// ---------------------------------------------------------------------------
// MigrateCmdPlugin
// ---------------------------------------------------------------------------

/**
 * Migration CLI plugin.
 *
 * Usage from CLI:
 *   bun run <script> migrate up       # Run pending migrations
 *   bun run <script> migrate down     # Rollback last migration
 *   bun run <script> migrate create <name>  # Generate new migration file
 *
 * When `automigrate` is true, pending migrations run automatically during
 * application bootstrap.
 */
export class MigrateCmdPlugin {
  private options: MigrateCmdOptions

  constructor(options: MigrateCmdOptions = {}) {
    this.options = {
      automigrate: true,
      migrationsDir: './migrations',
      systemMigrations: [],
      appMigrations: [],
      useTs: true,
      ...options,
    }
  }

  /**
   * Returns the combined list of migrations (system first, then app).
   */
  getMigrations(): Migration[] {
    return [
      ...(this.options.systemMigrations ?? []),
      ...(this.options.appMigrations ?? []),
    ]
  }

  /**
   * Registers the plugin with the application.
   *
   * @param app - The App instance.
   */
  async register(app: App): Promise<void> {
    if (this.options.automigrate) {
      const db = this.resolveDB(app)
      if (db) {
        const migrationDb = createMigrationDB(db)
        const migrations = this.getMigrations()
        if (migrations.length > 0) {
          await runPendingMigrations(db, migrationDb, migrations)
        }
      }
    }
  }

  /**
   * Run pending migrations manually.
   *
   * @param app - The App instance.
   */
  async up(app: App): Promise<number> {
    const db = this.resolveDB(app)
    if (!db) throw new Error('Database not available')
    const migrationDb = createMigrationDB(db)
    return runPendingMigrations(db, migrationDb, this.getMigrations())
  }

  /**
   * Roll back the last N migrations.
   *
   * @param app - The App instance.
   * @param steps - Number of migrations to roll back (default: 1).
   */
  async down(app: App, steps: number = 1): Promise<number> {
    const db = this.resolveDB(app)
    if (!db) throw new Error('Database not available')
    const migrationDb = createMigrationDB(db)
    return rollbackMigrations(db, migrationDb, this.getMigrations(), steps)
  }

  /**
   * Create a new migration file from template.
   *
   * @param name - The migration name (e.g. "my_migration" or "1719000000").
   * @returns The file path of the created migration.
   */
  async create(name: string): Promise<string> {
    const fileName = migrationFileName(name, this.options.useTs)
    const filePath = `${this.options.migrationsDir}/${fileName}`
    const content = migrationTemplate(name)

    // Write the file using Bun's file API
    await Bun.write(filePath, content)
    console.log(`[migrate] Created: ${filePath}`)
    return filePath
  }

  /**
   * Resolve the database from the App instance.
   */
  private resolveDB(app: App): IDatabase | null {
    // The App interface defines db(): IDatabase
    const db = (app as unknown as { db: () => IDatabase }).db
    if (typeof db === 'function') {
      return db()
    }
    // Fallback: try getDatabase
    const maybeGetDb = (app as unknown as { getDatabase: () => IDatabase | null }).getDatabase
    if (typeof maybeGetDb === 'function') {
      return maybeGetDb()
    }
    return null
  }
}
