/**
 * Migration database type — minimal interface for raw SQL execution
 * needed by migration functions.
 *
 * Port of PocketBase's tools/migrate package (Go -> TypeScript).
 * Layer 5 -- used by all migration files.
 */

/**
 * MigrationDB provides a raw SQL execution method that migration
 * functions use to alter the database schema.
 *
 * The actual implementation wraps a Kysely instance with the `sql`
 * template tag from the `kysely` package.
 */
export interface MigrationDB {
  /**
   * Execute a raw SQL string against the database.
   *
   * @param sql - The SQL statement to execute.
   */
  raw(sql: string): Promise<void>
}

/**
 * Migration interface for use with the migration plugin.
 *
 * Each migration exports `up(db)` and optionally `down(db)`.
 */
export interface Migration {
  /** Unique name for this migration (usually a timestamp). */
  name: string

  /** Apply the migration. */
  up: (db: MigrationDB) => Promise<void>

  /** Optional rollback. */
  down?: (db: MigrationDB) => Promise<void>
}
