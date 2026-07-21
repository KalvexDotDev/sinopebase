/**
 * MFA queries — finding and managing MFA records.
 *
 * Port of PocketBase's daos (Go -> TypeScript).
 */

import type { IDatabase } from './db-interface'
import { MFA } from './mfa_model'

/**
 * Creates an MFA query builder instance.
 */
export function createMFAQuery(db: IDatabase) {
  return {
    /** Find all MFA records linked to an auth record. */
    async findAllByRecord(recordId: string): Promise<MFA[]> {
      const rows = await db.select('_mfas', {
        filters: [{ column: 'recordId', operator: 'eq', value: recordId }],
      })
      return rows.map((r) => Object.assign(new MFA(), r))
    },

    /** Find an MFA record by its id. */
    async findById(id: string): Promise<MFA | null> {
      const rows = await db.select('_mfas', {
        filters: [{ column: 'id', operator: 'eq', value: id }],
        limit: 1,
      })
      if (rows.length === 0) return null
      return Object.assign(new MFA(), rows[0])
    },

    /** Delete all MFA records linked to a record. */
    async deleteAllByRecord(recordId: string): Promise<void> {
      await db.delete('_mfas', [
        { column: 'recordId', operator: 'eq', value: recordId },
      ])
    },

    /** Delete expired MFA records. */
    async deleteExpired(): Promise<void> {
      await db.delete('_mfas', [
        {
          column: 'expiresAt',
          operator: 'lt',
          value: new Date().toISOString(),
        },
      ])
    },
  }
}
