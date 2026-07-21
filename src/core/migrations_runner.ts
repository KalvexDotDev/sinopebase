/**
 * Migration runner — applies pending migrations.
 *
 * Port of PocketBase's tools/migrate/runner.go (Go -> TypeScript).
 *
 * Tracks applied migrations in a `_migrations` table and applies
 * any new migrations during bootstrap.
 */

import type { IDatabase } from './db-interface'
import type { Migration } from './migrations_list'

/**
 * Migration record stored in the database.
 */
interface MigrationRecord {
  id: string
  name: string
  appliedAt: string
}

/**
 * Migration runner that tracks and applies migrations.
 */
export class MigrationRunner {
  private migrations: Migration[] = []
  private applied: Set<string> = new Set()

  /**
   * Creates a new MigrationRunner.
   *
   * @param db - The database instance.
   * @param tableName - The table name for tracking migrations.
   */
  constructor(
    private db: IDatabase,
    private tableName = '_migrations',
  ) {}

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
   */
  async ensureTable(): Promise<void> {
    if (!(await this.db.hasTable(this.tableName))) {
      await this.db.createTable(this.tableName)
    }
  }

  /**
   * Loads already-applied migrations from the database.
   */
  async loadApplied(): Promise<void> {
    await this.ensureTable()

    const rows = await this.db.select(this.tableName, {})
    for (const row of rows) {
      const name = row['name'] as string
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
      await migration.up()

      await this.db.insert(this.tableName, {
        name: migration.name,
        appliedAt: new Date().toISOString(),
      })

      this.applied.add(migration.name)
      count++
    }

    return count
  }
}
