/**
 * ExternalAuth queries — finding and managing external auth records.
 *
 * Port of PocketBase's daos/external_auth.go (Go -> TypeScript).
 */

import type { IDatabase } from './db-interface'
import { ExternalAuth } from './external_auth_model'

/**
 * Creates an ExternalAuth query builder instance.
 */
export function createExternalAuthQuery(db: IDatabase) {
  return {
    /** Find all ExternalAuth records linked to an auth record. */
    async findAllByRecord(recordId: string): Promise<ExternalAuth[]> {
      const rows = await db.select('_externalAuths', {
        filters: [{ column: 'recordId', operator: 'eq', value: recordId }],
      })
      return rows.map((r) => Object.assign(new ExternalAuth(), r))
    },

    /** Find all ExternalAuth records linked to a collection. */
    async findAllByCollection(collectionId: string): Promise<ExternalAuth[]> {
      const rows = await db.select('_externalAuths', {
        filters: [{ column: 'collectionId', operator: 'eq', value: collectionId }],
      })
      return rows.map((r) => Object.assign(new ExternalAuth(), r))
    },

    /** Find the first ExternalAuth matching a filter expression. */
    async findFirstByProvider(provider: string, providerId: string): Promise<ExternalAuth | null> {
      const rows = await db.select('_externalAuths', {
        filters: [
          { column: 'provider', operator: 'eq', value: provider },
          { column: 'providerId', operator: 'eq', value: providerId },
        ],
        limit: 1,
      })
      if (rows.length === 0) return null
      return Object.assign(new ExternalAuth(), rows[0])
    },

    /** Delete all ExternalAuth records linked to a record. */
    async deleteAllByRecord(recordId: string): Promise<void> {
      await db.delete('_externalAuths', [{ column: 'recordId', operator: 'eq', value: recordId }])
    },
  }
}
