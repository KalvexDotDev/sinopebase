/**
 * Query router — routes SELECT queries to the read pool and writes to the write pool.
 *
 * Port of PocketBase's dualDBBuilder pattern from core/base.go
 * (Go -> TypeScript).
 *
 * In PocketBase, the DB() method returns a builder that automatically
 * routes SELECT queries to a concurrent (multi-connection) pool and
 * everything else to a non-concurrent (single-connection) pool to
 * minimize SQLITE_BUSY errors.
 *
 * In our PostgreSQL-backed implementation, this separation is less
 * critical (PostgreSQL handles concurrent writes well), but we still
 * provide the abstraction for compatibility with the PocketBase API.
 */

import type { IDatabase } from './db-interface'
import type { Filter } from './db-interface'
import type { SelectOptions } from './db-interface'

/**
 * DbQueryType represents the type of database operation.
 */
export type DbQueryType = 'select' | 'insert' | 'update' | 'delete' | 'upsert' | 'count'

/**
 * QueryRouter routes database operations to the appropriate pool.
 *
 * In PocketBase, SELECT queries go to the concurrent (read) pool while
 * writes go to the non-concurrent (write) pool.
 */
export class QueryRouter {
  /**
   * Creates a new QueryRouter.
   *
   * @param concurrentDB - The concurrent/read pool database.
   * @param nonconcurrentDB - The non-concurrent/write pool database.
   */
  /** The concurrent database pool (used for SELECT queries). */
  concurrentDB: IDatabase
  /** The non-concurrent database pool (used for write queries). */
  nonconcurrentDB: IDatabase

  constructor(
    /** The concurrent database pool (used for SELECT queries). */
    concurrentDB: IDatabase,
    /** The non-concurrent database pool (used for write queries). */
    nonconcurrentDB: IDatabase,
  ) {
    this.concurrentDB = concurrentDB
    this.nonconcurrentDB = nonconcurrentDB
  }

  /**
   * Routes a query to the appropriate database pool based on query type.
   *
   * SELECT and COUNT queries use the concurrent (read) pool.
   * INSERT, UPDATE, DELETE, and UPSERT use the non-concurrent (write) pool.
   *
   * @param type - The type of database query.
   * @returns The database instance to use.
   */
  route(type: DbQueryType): IDatabase {
    if (type === 'select' || type === 'count') {
      return this.concurrentDB
    }
    return this.nonconcurrentDB
  }

  /**
   * Routes a SELECT query to the concurrent pool.
   */
  async select(
    table: string,
    options: SelectOptions,
  ): Promise<Record<string, unknown>[]> {
    return this.concurrentDB.select(table, options)
  }

  /**
   * Routes a COUNT query to the concurrent pool.
   */
  async count(
    table: string,
    filters?: Filter[],
  ): Promise<number> {
    return this.concurrentDB.count(table, filters)
  }

  /**
   * Routes an INSERT query to the write pool.
   */
  async insert(
    table: string,
    record: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.nonconcurrentDB.insert(table, record)
  }

  /**
   * Routes an UPSERT query to the write pool.
   */
  async upsert(
    table: string,
    record: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.nonconcurrentDB.upsert(table, record)
  }

  /**
   * Routes an UPDATE query to the write pool.
   */
  async update(
    table: string,
    filters: Filter[],
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> {
    return this.nonconcurrentDB.update(table, filters, data)
  }

  /**
   * Routes a DELETE query to the write pool.
   */
  async delete(
    table: string,
    filters: Filter[],
  ): Promise<Record<string, unknown>[]> {
    return this.nonconcurrentDB.delete(table, filters)
  }

  /**
   * Routes table creation to the write pool.
   */
  async createTable(table: string): Promise<void> {
    return this.nonconcurrentDB.createTable(table)
  }

  /**
   * Routes hasTable check to either pool (read is fine).
   */
  async hasTable(table: string): Promise<boolean> {
    return this.concurrentDB.hasTable(table)
  }

  /**
   * Routes table drop to the write pool.
   */
  async dropTable(table: string): Promise<void> {
    return this.nonconcurrentDB.dropTable(table)
  }
}
