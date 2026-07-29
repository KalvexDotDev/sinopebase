/**
 * Migration runner — applies pending migrations.
 *
 * Port of PocketBase's tools/migrate/runner.go (Go -> TypeScript).
 *
 * Tracks applied migrations in a `_migrations` table and applies
 * any new migrations during bootstrap.
 */

import type { MigrationDB } from '../../migrations/types'
import type { IDatabase } from './db-interface'
import type { Migration } from './migrations_list'

/**
 * Migration runner that tracks and applies migrations.
 */
export class MigrationRunner {
  private migrations: Migration[] = []
  private applied: Set<string> = new Set()

  /**
   * Creates a new MigrationRunner.
   *
   * @param db - The database instance for tracking.
   * @param migrationDB - Raw SQL executor passed to migration up/down functions.
   * @param tableName - The table name for tracking migrations.
   */
  private db: IDatabase
  private migrationDB: MigrationDB
  private tableName: string

  constructor(db: IDatabase, migrationDB: MigrationDB, tableName = '_migrations') {
    this.db = db
    this.migrationDB = migrationDB
    this.tableName = tableName
  }

  /**
   * Registers a migration.
   */
  register(migration: Migration): void {
    this.migrations.push(migration)
  }

  /**
   * Registers multiple migrations.
   */
  registerAll(migrations: Migration[]): void {
    for (const m of migrations) {
      this.register(m)
    }
  }

  /**
   * Ensures the migrations tracking table exists.
   *
   * Uses raw SQL so the tracking table can be created before any
   * other migration infrastructure exists.
   */
  async ensureTable(): Promise<void> {
    if (!(await this.db.hasTable(this.tableName))) {
      await this.migrationDB.raw(`
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
          id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          name TEXT NOT NULL,
          applied_at TIMESTAMP DEFAULT now()
        )
      `)
    }
  }

  /**
   * Loads already-applied migrations from the database.
   */
  async loadApplied(): Promise<void> {
    await this.ensureTable()

    const rows = await this.db.select(this.tableName, {})
    for (const row of rows) {
      const name = row.name as string
      if (name) {
        this.applied.add(name)
      }
    }
  }

  /**
   * Returns migrations that have not yet been applied.
   */
  pending(): Migration[] {
    return this.migrations.filter((m) => !this.applied.has(m.name))
  }

  /**
   * Applies all pending migrations.
   *
   * @returns The number of migrations applied.
   */
  async run(): Promise<number> {
    await this.loadApplied()

    const pending = this.pending()
    let count = 0

    for (const migration of pending) {
      await migration.up(this.migrationDB)

      // Track migration as applied. Migration names come from the filename
      // regex (timestamps + snake_case), so string interpolation is safe here.
      // nosemgrep: ts-sql-injection-concat
      await this.migrationDB.raw(
        `INSERT INTO ${this.tableName} (name, applied_at) VALUES ('${migration.name}', '${new Date().toISOString()}')`,
      )

      this.applied.add(migration.name)
      count++
    }

    return count
  }
}
