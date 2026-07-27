/**
 * AuthOrigin queries — finding and managing auth origin records.
 *
 * Port of PocketBase's daos (Go -> TypeScript).
 */

import { AuthOrigin } from './auth_origin_model'
import type { IDatabase } from './db-interface'

/**
 * Creates an AuthOrigin query builder instance.
 */
export function createAuthOriginQuery(db: IDatabase) {
  return {
    /** Find all auth origins for a record (in DESC order). */
    async findAllByRecord(recordId: string): Promise<AuthOrigin[]> {
      const rows = await db.select('_authOrigins', {
        filters: [{ column: 'recordId', operator: 'eq', value: recordId }],
      })
      return rows.map((r) => Object.assign(new AuthOrigin(), r))
    },

    /** Find an auth origin by record and fingerprint. */
    async findByRecordAndFingerprint(
      recordId: string,
      fingerprint: string,
    ): Promise<AuthOrigin | null> {
      const rows = await db.select('_authOrigins', {
        filters: [
          { column: 'recordId', operator: 'eq', value: recordId },
          { column: 'fingerprint', operator: 'eq', value: fingerprint },
        ],
        limit: 1,
      })
      if (rows.length === 0) return null
      return Object.assign(new AuthOrigin(), rows[0])
    },

    /** Delete all auth origins linked to a record. */
    async deleteAllByRecord(recordId: string): Promise<void> {
      await db.delete('_authOrigins', [{ column: 'recordId', operator: 'eq', value: recordId }])
    },
  }
}
