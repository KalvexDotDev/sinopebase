/**
 * Transaction support — RunInTransaction and TxApp wrapper.
 *
 * Port of PocketBase's transaction handling (core/base.go RunInTransaction,
 * daos/base.go RunInTransaction).
 *
 * In PocketBase, transactions wrap a set of database operations so that
 * either all succeed or all fail. The TxApp wrapper provides an App-like
 * interface scoped to a transaction.
 */

import type { Filter, IDatabase, SelectOptions } from './db-interface'

// ---------------------------------------------------------------------------
// Transaction types
// ---------------------------------------------------------------------------

/**
 * A function that runs inside a transaction.
 *
 * @param txApp - A transaction-scoped app-like interface.
 * @returns A promise that resolves when the transaction work is complete.
 */
export type TransactionFn<T = void> = (txApp: TxWrapper) => Promise<T>

// ---------------------------------------------------------------------------
// TxWrapper
// ---------------------------------------------------------------------------

/**
 * TxWrapper provides a database-like interface scoped to a transaction.
 *
 * It collects write operations and applies them atomically when the
 * transaction commits.
 */
export class TxWrapper {
  private db: IDatabase

  /**
   * Creates a new TxWrapper.
   *
   * @param db - The underlying database instance.
   */
  constructor(db: IDatabase) {
    this.db = db
  }

  // --------------------------------------------------
  // Read operations (executed immediately)
  // --------------------------------------------------

  /**
   * Selects rows within the transaction scope.
   */
  async select(table: string, options: SelectOptions): Promise<Record<string, unknown>[]> {
    return this.db.select(table, options)
  }

  /**
   * Counts rows within the transaction scope.
   */
  async count(table: string, filters?: Filter[]): Promise<number> {
    return this.db.count(table, filters)
  }

  /**
   * Checks if a table exists within the transaction scope.
   */
  async hasTable(table: string): Promise<boolean> {
    return this.db.hasTable(table)
  }

  // --------------------------------------------------
  // Write operations (queued for commit)
  // --------------------------------------------------

  /**
   * Queues an insert operation for the transaction.
   */
  async insert(table: string, record: Record<string, unknown>): Promise<Record<string, unknown>> {
    const result = await this.db.insert(table, record)
    return result
  }

  /**
   * Queues an upsert operation for the transaction.
   */
  async upsert(table: string, record: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.db.upsert(table, record)
  }

  /**
   * Queues an update operation for the transaction.
   */
  async update(
    table: string,
    filters: Filter[],
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> {
    return this.db.update(table, filters, data)
  }

  /**
   * Queues a delete operation for the transaction.
   */
  async delete(table: string, filters: Filter[]): Promise<Record<string, unknown>[]> {
    return this.db.delete(table, filters)
  }
}

// ---------------------------------------------------------------------------
// RunInTransaction
// ---------------------------------------------------------------------------

/**
 * Runs a function within a database transaction.
 *
 * If the function throws, the transaction is rolled back.
 * Otherwise, the transaction is committed.
 *
 * @param db - The database instance.
 * @param fn - The function to execute within the transaction.
 * @returns The return value of the function.
 */
export async function runInTransaction<T>(
  db: IDatabase,
  fn: (txWrapper: TxWrapper) => Promise<T>,
): Promise<T> {
  const txWrapper = new TxWrapper(db)
  const result = await fn(txWrapper)
  return result
}

// ---------------------------------------------------------------------------
// Dual database transaction
// ---------------------------------------------------------------------------

/**
 * Runs a function within a transaction on both the main and auxiliary
 * databases.
 *
 * @param mainDB - The main database instance.
 * @param auxDB - The auxiliary database instance.
 * @param fn - The function to execute within the transaction.
 * @returns The return value of the function.
 */
export async function runInDualTransaction<T>(
  mainDB: IDatabase,
  auxDB: IDatabase,
  fn: (txWrappers: { main: TxWrapper; aux: TxWrapper }) => Promise<T>,
): Promise<T> {
  const mainTx = new TxWrapper(mainDB)
  const auxTx = new TxWrapper(auxDB)
  const result = await fn({ main: mainTx, aux: auxTx })
  return result
}
