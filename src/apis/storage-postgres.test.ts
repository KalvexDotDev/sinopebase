/**
 * @new-code-test positive src/apis/storage-postgres.ts
 * @new-code-test negative src/apis/storage-postgres.ts
 */
import { describe, expect, it } from 'bun:test'
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely'
import type { PostgresDatabase } from '../core/db-postgres'
import { PostgresStorageAccessPolicy } from './storage-postgres'

describe('PostgreSQL storage metadata grants', () => {
  it('grants bucket deletion to service_role during startup', async () => {
    const statements: string[] = []
    const db = new Kysely<unknown>({
      dialect: {
        createAdapter: () => new PostgresAdapter(),
        createDriver: () =>
          Object.assign(new DummyDriver(), {
            acquireConnection: async () => ({
              executeQuery: async ({ sql }: { sql: string }) => {
                statements.push(sql)
                return { rows: [] }
              },
              streamQuery: async function* () {},
            }),
          }),
        createIntrospector: (db) => new PostgresIntrospector(db),
        createQueryCompiler: () => new PostgresQueryCompiler(),
      },
    })
    try {
      await PostgresStorageAccessPolicy.ensureMetadata({
        getWriter: () => db,
      } as unknown as PostgresDatabase)
      expect(statements).toContain('GRANT DELETE ON storage.buckets TO service_role')
    } finally {
      await db.destroy()
    }
  })
})
