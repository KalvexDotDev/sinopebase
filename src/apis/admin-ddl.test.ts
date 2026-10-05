/**
 * @new-code-test positive src/apis/admin-ddl.ts
 * @new-code-test negative src/apis/admin-ddl.ts
 */
import { describe, expect, it } from 'bun:test'
import type { Pool } from 'pg'
import { createAdminDdlPlugin } from './admin-ddl'

function app(authorized = true, failQuery = false) {
  const queries: string[] = []
  const pool = {
    query: async (sql: string) => {
      queries.push(sql)
      if (failQuery) throw new Error('database unavailable')
      return { rows: [] }
    },
  } as unknown as Pool
  return { handler: createAdminDdlPlugin(pool, () => authorized), queries }
}

function create(body: unknown) {
  return new Request('http://localhost/api/admin/tables', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('admin table DDL validation', () => {
  it('rejects SQL in a column type before querying the database', async () => {
    const { handler, queries } = app()
    const response = await handler.handle(
      create({
        name: 'items',
        columns: [{ name: 'title', type: 'text); DROP TABLE users; --', nullable: true }],
      }),
    )
    expect(response.status).toBe(400)
    expect(queries).toEqual([])
  })

  it('rejects SQL in a default before querying the database', async () => {
    const { handler, queries } = app()
    const response = await handler.handle(
      create({
        name: 'items',
        columns: [
          { name: 'title', type: 'text', nullable: true, default: "''; DROP TABLE users; --" },
        ],
      }),
    )
    expect(response.status).toBe(400)
    expect(queries).toEqual([])
  })

  it('rejects empty and duplicate column definitions', async () => {
    const { handler, queries } = app()
    const empty = await handler.handle(create({ name: 'items', columns: [] }))
    expect(empty.status).toBe(400)
    const duplicate = await handler.handle(
      create({
        name: 'items',
        columns: [
          { name: 'id', type: 'text', nullable: false },
          { name: 'id', type: 'text', nullable: false },
        ],
      }),
    )
    expect(duplicate.status).toBe(400)
    expect(queries).toEqual([])
  })

  it('rejects multiple primary keys and malformed drop names', async () => {
    const { handler, queries } = app()
    const primaryKeys = await handler.handle(
      create({
        name: 'items',
        columns: [
          { name: 'first', type: 'text', primary: true },
          { name: 'second', type: 'text', primary: true },
        ],
      }),
    )
    expect(primaryKeys.status).toBe(400)
    const drop = await handler.handle(
      new Request('http://localhost/api/admin/tables/bad%20name', { method: 'DELETE' }),
    )
    expect(drop.status).toBe(400)
    expect(queries).toEqual([])
  })

  it('accepts the types and defaults used by the table wizard', async () => {
    const { handler, queries } = app()
    const response = await handler.handle(
      create({
        name: 'items',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            nullable: false,
            primary: true,
            default: 'gen_random_uuid()',
          },
          { name: 'title', type: 'text', nullable: true },
        ],
      }),
    )
    expect(response.status).toBe(200)
    expect(queries).toHaveLength(1)
    expect(queries[0]).toContain('CREATE TABLE "items"')
  })

  it('drops a valid table for service_role and reports database failures', async () => {
    const success = app()
    const url = 'http://localhost/api/admin/tables/items'
    expect((await success.handler.handle(new Request(url, { method: 'DELETE' }))).status).toBe(200)
    expect(success.queries).toContain('DROP TABLE IF EXISTS "items" CASCADE')

    const failed = app(true, true)
    const response = await failed.handler.handle(new Request(url, { method: 'DELETE' }))
    expect(response.status).toBe(500)
  })

  it('denies table deletion without service_role', async () => {
    const denied = app(false)
    const response = await denied.handler.handle(
      new Request('http://localhost/api/admin/tables/items', { method: 'DELETE' }),
    )
    expect(response.status).toBe(403)
    expect(denied.queries).toEqual([])
  })

  it('denies table creation without service_role and invalid table names', async () => {
    const denied = app(false)
    const body = { name: 'items', columns: [{ name: 'id', type: 'text', nullable: false }] }
    expect((await denied.handler.handle(create(body))).status).toBe(403)
    expect(denied.queries).toEqual([])

    const valid = app()
    expect((await valid.handler.handle(create({ ...body, name: 'bad name' }))).status).toBe(400)
    expect(valid.queries).toEqual([])
  })
})
