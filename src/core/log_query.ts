/**
 * Log queries — building and executing log-related database queries.
 *
 * Port of PocketBase's daos/log.go (Go -> TypeScript).
 */

import type { IDatabase } from './db-interface'
import { Log } from './log_model'

/**
 * Creates a log query builder instance.
 */
export function createLogQuery(db: IDatabase) {
  return {
    /** Find a single log entry by its id. */
    async findById(id: string): Promise<Log | null> {
      const rows = await db.select('_logs', {
        filters: [{ column: 'id', operator: 'eq', value: id }],
        limit: 1,
      })
      if (rows.length === 0) return null
      return Object.assign(new Log(), rows[0])
    },

    /** Delete logs created before the specified timestamp. */
    async deleteOldLogs(createdBefore: Date): Promise<void> {
      await db.delete('_logs', [
        {
          column: 'created',
          operator: 'lt',
          value: createdBefore.toISOString(),
        },
      ])
    },
  }
}
