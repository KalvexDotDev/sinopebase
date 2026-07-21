import { describe, it, expect, mock } from 'bun:test'
import { runPendingMigrations, rollbackMigrations } from './automigrate.ts'
import type { IDatabase } from '~/core/db-interface.ts'
import type { MigrationDB, Migration } from '../../migrations/types.ts'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMockDB(): IDatabase {
  const applied = new Map<string, string>() // name -> applied_at

  return {
    createTable: mock(async (_table: string) => {}),
    hasTable: mock(async (_table: string) => true),
    dropTable: mock(async () => {}),
    insert: mock(async (table: string, record: Record<string, unknown>) => {
      if (table === '_migrations') {
        applied.set(String(record.name), String(record.applied_at))
      }
      return { id: 'mock-id', ...record }
    }),
    upsert: mock(async () => ({ id: 'mock-id' })),
    select: mock(async (table: string) => {
      if (table === '_migrations') {
        return Array.from(applied.entries()).map(([name, appliedAt]) => ({
          name,
          applied_at: appliedAt,
        }))
      }
      return []
    }),
    update: mock(async () => []),
    delete: mock(async (table: string, filters: unknown[]) => {
      if (table === '_migrations') {
        const f = filters as Array<{ column: string; value: string }>
        const nameFilter = f.find((x) => x.column === 'name')
        if (nameFilter) {
          applied.delete(nameFilter.value)
        }
      }
      return []
    }),
    count: mock(async () => 0),
  }
}

function createMigrationDB(): MigrationDB {
  return { raw: mock(async () => {}) }
}

describe('automigrate', () => {
  describe('runPendingMigrations', () => {
    it('runs all migrations when none are applied', async () => {
      const db = createMockDB()
      const mdb = createMigrationDB()
      const results: string[] = []

      const migrations: Migration[] = [
        { name: 'm1', up: mock(async () => { results.push('m1') }) },
        { name: 'm2', up: mock(async () => { results.push('m2') }) },
      ]

      const count = await runPendingMigrations(db, mdb, migrations)
      expect(count).toBe(2)
      expect(results).toEqual(['m1', 'm2'])
    })

    it('skips already-applied migrations', async () => {
      const db = createMockDB()
      // Pre-apply m1
      await db.insert('_migrations', {
        name: 'm1',
        applied_at: new Date().toISOString(),
      })

      const mdb = createMigrationDB()
      const results: string[] = []

      const migrations: Migration[] = [
        { name: 'm1', up: mock(async () => { results.push('m1') }) },
        { name: 'm2', up: mock(async () => { results.push('m2') }) },
      ]

      const count = await runPendingMigrations(db, mdb, migrations)
      expect(count).toBe(1)
      expect(results).toEqual(['m2'])
    })

    it('returns 0 when all migrations are applied', async () => {
      const db = createMockDB()
      await db.insert('_migrations', {
        name: 'm1',
        applied_at: new Date().toISOString(),
      })

      const mdb = createMigrationDB()
      const migrations: Migration[] = [
        { name: 'm1', up: mock(async () => {}) },
      ]

      const count = await runPendingMigrations(db, mdb, migrations)
      expect(count).toBe(0)
    })
  })

  describe('rollbackMigrations', () => {
    it('rolls back the last applied migration', async () => {
      const db = createMockDB()
      await db.insert('_migrations', {
        name: 'm1',
        applied_at: new Date().toISOString(),
      })
      await db.insert('_migrations', {
        name: 'm2',
        applied_at: new Date().toISOString(),
      })

      const mdb = createMigrationDB()
      const rolledBack: string[] = []

      const migrations: Migration[] = [
        {
          name: 'm1',
          up: mock(async () => {}),
          down: mock(async () => { rolledBack.push('m1') }),
        },
        {
          name: 'm2',
          up: mock(async () => {}),
          down: mock(async () => { rolledBack.push('m2') }),
        },
      ]

      const count = await rollbackMigrations(db, mdb, migrations)
      expect(count).toBe(1)
      expect(rolledBack).toEqual(['m2'])
    })

    it('skips migrations without down function', async () => {
      const db = createMockDB()
      await db.insert('_migrations', {
        name: 'm1',
        applied_at: new Date().toISOString(),
      })

      const mdb = createMigrationDB()
      const migrations: Migration[] = [
        { name: 'm1', up: mock(async () => {}) }, // no down
      ]

      const count = await rollbackMigrations(db, mdb, migrations)
      expect(count).toBe(1) // skipped but counted
    })
  })
})
