/**
 * Database connection factory.
 *
 * Port of PocketBase's core/db.go connectDB() and related logic
 * (Go -> TypeScript).
 *
 * Creates and returns an IDatabase instance (PostgresDatabase or MemoryDatabase)
 * based on the POSTGRES_URL environment variable.
 */

import type { IDatabase } from './db-interface'
import { MemoryDatabase } from './db-memory'
import { PostgresDatabase } from './db-postgres'

/** Connection factory configuration. */
export interface DbConnectConfig {
  /** PostgreSQL connection URL. If empty, uses in-memory database. */
  postgresUrl?: string

  /** Maximum pool size (PostgreSQL only). */
  maxPoolSize?: number

  /** The data directory for file-based storage. */
  dataDir?: string
}

/**
 * Creates and returns a database connection.
 *
 * If `postgresUrl` is provided (or `POSTGRES_URL` env var is set),
 * returns a PostgresDatabase instance. Otherwise returns an in-memory
 * MemoryDatabase.
 *
 * @param config - Optional connection configuration.
 * @returns A promise that resolves to an IDatabase instance.
 */
export async function createDatabase(
  config?: DbConnectConfig,
): Promise<IDatabase> {
  const postgresUrl =
    config?.postgresUrl || process.env.POSTGRES_URL || ''

  if (postgresUrl) {
    const db = new PostgresDatabase({
      postgresUrl,
      maxPoolSize: config?.maxPoolSize ?? 10,
    })
    await db.connect()
    return db
  }

  // Fallback to in-memory database
  const db = new MemoryDatabase()
  return db
}

/**
 * Creates a database connection explicitly for the auxiliary/logs database.
 *
 * PocketBase uses a separate auxiliary database for logs and other
 * non-critical data. In our PostgreSQL setup, we share the same connection
 * pool since PostgreSQL handles concurrency better than SQLite.
 *
 * @param config - Optional connection configuration.
 * @returns A promise that resolves to an IDatabase instance.
 */
export async function createAuxDatabase(
  config?: DbConnectConfig,
): Promise<IDatabase> {
  // For now, same as the main database (PostgreSQL vs memory)
  return createDatabase(config)
}

/**
 * Default database configuration constants.
 *
 * Mirrors PocketBase's DefaultDataMaxOpenConns, etc.
 */
export const DefaultDataMaxOpenConns = 120
export const DefaultDataMaxIdleConns = 20
export const DefaultLogsMaxOpenConns = 10
export const DefaultLogsMaxIdleConns = 2
