/**
 * Database connection factory.
 *
 * Port of PocketBase's core/db.go connectDB() and related logic
 * (Go -> TypeScript).
 *
 * Creates and returns an IDatabase instance (PostgresDatabase or MemoryDatabase)
 * based on the POSTGRES_URL environment variable.
 *
 * Supports least-privilege roles: the connection pool authenticates as the
 * owner but immediately SET ROLE to {@link runtimeRole} (default sinopebase_app)
 * on each connection, so runtime operations never run as a superuser.
 */

import type { IDatabase } from './db-interface'
import { MemoryDatabaseAdapter } from './db-memory-adapter'
import { PostgresDatabase } from './db-postgres'

/** Connection factory configuration. */
export interface DbConnectConfig {
  /** PostgreSQL connection URL. If empty, uses in-memory database. */
  postgresUrl?: string

  /** Maximum pool size (PostgreSQL only). */
  maxPoolSize?: number

  /** The data directory for file-based storage. */
  dataDir?: string

  /**
   * The PostgreSQL role the pool assumes immediately after connecting.
   *
   * Default: 'sinopebase_app' (low privilege). The pool authenticates as
   * the connection owner described by {@link postgresUrl} but immediately
   * runs `SET ROLE <runtimeRole>` on each new connection. Individual
   * request transactions then elevate further via `SET LOCAL ROLE`.
   *
   * Set to '' or null to disable automatic role switching (e.g. for
   * administrative tooling that needs the owner's full privileges).
   */
  runtimeRole?: string
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
export async function createDatabase(config?: DbConnectConfig): Promise<IDatabase> {
  const postgresUrl = config?.postgresUrl || process.env.POSTGRES_URL || ''

  if (postgresUrl) {
    const db = new PostgresDatabase({
      postgresUrl,
      maxPoolSize: config?.maxPoolSize ?? 10,
      runtimeRole: config?.runtimeRole,
    })
    await db.connect()
    return db
  }

  // Fallback to in-memory database
  return new MemoryDatabaseAdapter()
}

/**
 * Temporarily elevate a database client to service_role.
 *
 * Uses `SET LOCAL ROLE service_role` so the elevation is scoped to the
 * current transaction. The session-level role (sinopebase_app) is
 * automatically restored when the transaction ends.
 *
 * @param client - A pg.PoolClient or pg.Client instance.
 */
export async function elevateToServiceRole(
  client: { query: (text: string, values?: unknown[]) => Promise<unknown> },
): Promise<void> {
  await client.query('SET LOCAL ROLE service_role')
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
export async function createAuxDatabase(config?: DbConnectConfig): Promise<IDatabase> {
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
