import { describe, it, expect, mock } from 'bun:test'
import { MigrateCmdPlugin } from './migratecmd.ts'
import type { IDatabase } from '~/core/db-interface.ts'

// ---------------------------------------------------------------------------
// Mock App
// ---------------------------------------------------------------------------

function createMockApp(db: IDatabase) {
  return {
    db: () => db,
    getDatabase: () => db,
  }
}

// ---------------------------------------------------------------------------
// Mock IDatabase
// ---------------------------------------------------------------------------

function createMockDB(): IDatabase {
  const tables = new Set<string>()
  const migrations: Array<{ name: string; applied_at: string }> = []

  return {
    createTable: mock(async (table: string) => {
      tables.add(table)
    }),
    hasTable: mock(async (table: string) => {
      return tables.has(table)
    }),
    dropTable: mock(async (table: string) => {
      tables.delete(table)
    }),
    insert: mock(async (table: string, record: Record<string, unknown>) => {
      if (table === '_migrations') {
        migrations.push({
          name: String(record['name'] ?? ''),
          applied_at: String(record['applied_at'] ?? ''),
        })
      }
      return { id: 'mock-id', ...record }
    }),
    upsert: mock(async () => ({ id: 'mock-id' })),
    select: mock(async (table: string) => {
      if (table === '_migrations') {
        return [...migrations]
      }
      return []
    }),
    update: mock(async () => []),
    delete: mock(async () => []),
    count: mock(async () => 0),
  }
}

describe('MigrateCmdPlugin', () => {
  it('creates with default options', () => {
    const plugin = new MigrateCmdPlugin()
    expect(plugin.getMigrations()).toEqual([])
  })

  it('accepts custom migrations', () => {
    const upMock = mock(async () => {})
    const downMock = mock(async () => {})

    const plugin = new MigrateCmdPlugin({
      appMigrations: [
        { name: 'test_migration', up: upMock, down: downMock },
      ],
    })

    expect(plugin.getMigrations().length).toBe(1)
    expect(plugin.getMigrations()[0]!.name).toBe('test_migration')
  })

  it('register runs pending migrations when automigrate is enabled', async () => {
    const upMock = mock(async () => {})
    const db = createMockDB()
    const app = createMockApp(db) as never

    const plugin = new MigrateCmdPlugin({
      automigrate: true,
      appMigrations: [
        { name: '001_test', up: upMock },
      ],
    })

    await plugin.register(app)
    expect(upMock).toHaveBeenCalled()
  })

  it('up() runs pending migrations', async () => {
    const results: string[] = []
    const db = createMockDB()
    const app = createMockApp(db) as never

    const plugin = new MigrateCmdPlugin({
      appMigrations: [
        { name: 'm1', up: mock(async () => { results.push('m1') }) },
        { name: 'm2', up: mock(async () => { results.push('m2') }) },
      ],
    })

    const count = await plugin.up(app)
    expect(count).toBe(2)
    expect(results).toEqual(['m1', 'm2'])
  })

  it('create generates a migration file', async () => {
    const plugin = new MigrateCmdPlugin({
      migrationsDir: '.',
    })

    const filePath = await plugin.create('test_create_migration')
    expect(filePath).toBe('./test_create_migration.ts')

    // Clean up
    await Bun.write(filePath, '')
    await Bun.file(filePath).delete?.()
  })
})
