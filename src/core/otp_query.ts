/**
 * OTP queries — finding and managing OTP records.
 *
 * Port of PocketBase's daos (Go -> TypeScript).
 */

import type { IDatabase } from './db-interface'
import { OTP } from './otp_model'

/**
 * Creates an OTP query builder instance.
 */
export function createOTPQuery(db: IDatabase) {
  return {
    /** Find all OTP records linked to an auth record. */
    async findAllByRecord(recordId: string): Promise<OTP[]> {
      const rows = await db.select('_otps', {
        filters: [{ column: 'recordId', operator: 'eq', value: recordId }],
      })
      return rows.map((r) => Object.assign(new OTP(), r))
    },

    /** Find an OTP record by its id. */
    async findById(id: string): Promise<OTP | null> {
      const rows = await db.select('_otps', {
        filters: [{ column: 'id', operator: 'eq', value: id }],
        limit: 1,
      })
      if (rows.length === 0) return null
      return Object.assign(new OTP(), rows[0])
    },

    /** Delete all OTP records linked to a record. */
    async deleteAllByRecord(recordId: string): Promise<void> {
      await db.delete('_otps', [
        { column: 'recordId', operator: 'eq', value: recordId },
      ])
    },

    /** Delete expired OTPs. */
    async deleteExpired(): Promise<void> {
      await db.delete('_otps', [
        {
          column: 'expiresAt',
          operator: 'lt',
          value: new Date().toISOString(),
        },
      ])
    },
  }
}
