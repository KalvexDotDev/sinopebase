import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { MemoryDatabase } from '../core/db-memory'
import { MemoryDatabaseAdapter } from '../core/db-memory-adapter'
import { mountPostgrestRoutes } from './postgrest'

async function head(
  app: Elysia,
  path: string,
  headers: Record<string, string> = {},
) {
  return app.handle(new Request(`http://localhost${path}`, {
    method: 'HEAD',
    headers,
  }))
}

describe('PostgREST HEAD count responses', () => {
  it('returns an exact filtered count and no body with the memory database', async () => {
    const memDb = new MemoryDatabase()
    memDb.insert('items', [
      { id: 'one', status: 'active', tenant_id: 'tenant-1' },
      { id: 'two', status: 'active', tenant_id: 'tenant-1' },
      { id: 'three', status: 'inactive', tenant_id: 'tenant-1' },
      { id: 'four', status: 'active', tenant_id: 'tenant-2' },
    ])
    const db = new MemoryDatabaseAdapter(memDb)
    const app = new Elysia()
    mountPostgrestRoutes(app, db)

    const response = await head(
      app,
      '/rest/v1/items?status=eq.active&tenant_id=eq.tenant-1',
      { prefer: 'count=exact' },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-range')).toBe('*/2')
    expect(await response.text()).toBe('')
  })

  it('awaits the PostgreSQL-style database count and forwards parsed filters', async () => {
    let capturedTable: string | undefined
    let capturedFilters: unknown
    let selectCalled = false
    const db = {
      count: async (table: string, filters: unknown) => {
        capturedTable = table
        capturedFilters = filters
        return 7
      },
      select: async () => {
        selectCalled = true
        return []
      },
    }
    const app = new Elysia()
    mountPostgrestRoutes(app, db as never)

    const response = await head(app, '/rest/v1/items?tenant_id=eq.tenant-1', {
      Prefer: 'return=minimal,count=exact',
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-range')).toBe('*/7')
    expect(await response.text()).toBe('')
    expect(capturedTable).toBe('items')
    expect(capturedFilters).toEqual([
      { column: 'tenant_id', operator: 'eq', value: 'tenant-1' },
    ])
    expect(selectCalled).toBe(false)
  })
})
