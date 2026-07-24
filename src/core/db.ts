/**
 * Database Layer — Kysely + PostgreSQL
 *
 * Port of PocketBase core/db.go + core/db_connect.go
 * Replaces modernc.org/sqlite with Kysely + Bun.sql → PostgreSQL
 */

import { Kysely, PostgresDialect, sql } from 'kysely'
import { Pool } from 'pg'


// ---------------------------------------------------------------------------
// Database interface (mirrors PocketBase's DB interface)
// ---------------------------------------------------------------------------

export interface Database {
  /** Kysely query builder — equivalent to PocketBase's dbx.Builder */
  readonly db: Kysely<DatabaseSchema>

  /** Run a raw SQL query */
  readonly sql: typeof sql

  /** Close all connections */
  close(): Promise<void>
}

/** Dynamic schema — collections define their own tables */
export type DatabaseSchema = Record<string, Record<string, unknown>>

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

export interface DbConfig {
  postgresUrl: string
  maxPoolSize?: number
}

/**
 * Create a database connection — mirrors PocketBase's DefaultDBConnect().
 */
export async function createDatabase(config: DbConfig): Promise<Database> {
  const dialect = new PostgresDialect({
    pool: new Pool({
      connectionString: config.postgresUrl,
      max: config.maxPoolSize ?? 10,
    }),
  })

  const db = new Kysely<DatabaseSchema>({ dialect })

  // Verify connection
  await sql`SELECT 1`.execute(db)

  return {
    db,
    sql,
    async close() {
      await db.destroy()
    },
  }
}
