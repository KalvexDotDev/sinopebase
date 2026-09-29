// @new-code-test positive src/core/db-postgres.ts
// @new-code-test negative src/core/db-postgres.ts
// @new-code-test positive src/apis/postgrest.ts
// @new-code-test negative src/apis/postgrest.ts
import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import type { RawBuilder } from 'kysely'
import { PostgresDatabase } from '../core/db-postgres'
import { mountPostgrestRoutes } from './postgrest'

/** Captures the compiled SQL of the filter expression instead of executing it. */
class RecordingQueryDouble {
  compiledSql: string | null = null
  compiledParameters: readonly unknown[] = []
  executorProvider: unknown

  selectAll(): this {
    return this
  }

  where(expression: RawBuilder<boolean>): this {
    const compiled = expression.compile(this.executorProvider as never)
    this.compiledSql = compiled.sql
    this.compiledParameters = compiled.parameters
    return this
  }

  async execute(): Promise<Record<string, unknown>[]> {
    return [{ id: 'document-one', version: '3' }]
  }
}

async function requestVersionFilter(filter: string) {
  const db = new PostgresDatabase({ postgresUrl: 'postgres://unused:unused@127.0.0.1:1/unused' })
  const query = new RecordingQueryDouble()
  query.executorProvider = db.getWriter()
  // The route reads rows through the private `reader`; swap in the recording double.
  const readerSlot = db as unknown as {
    reader: { selectFrom: (table: string) => RecordingQueryDouble }
  }
  readerSlot.reader = { selectFrom: () => query }

  const app = new Elysia()
  mountPostgrestRoutes(app, db as never)

  const response = await app.handle(
    new Request(`http://localhost/rest/v1/documents?version=${encodeURIComponent(filter)}`),
  )
  return { response, query }
}

describe('PostgREST match filters', () => {
  it('translates match to a case-sensitive, unanchored regex comparison', async () => {
    const { response, query } = await requestVersionFilter('match.^[1-9][0-9]{0,8}$')

    expect(response.status).toBe(200)
    expect(query.compiledSql).toContain('~')
    expect(query.compiledSql).not.toContain('~*')
    expect(query.compiledSql).not.toContain('LIKE')
    expect(query.compiledParameters).toEqual(['^[1-9][0-9]{0,8}$'])
  })

  it('translates imatch to a case-insensitive regex comparison without adding anchors', async () => {
    const { response, query } = await requestVersionFilter('imatch.v3')

    expect(response.status).toBe(200)
    expect(query.compiledSql).toContain('~*')
    expect(query.compiledParameters).toEqual(['v3'])
  })
})
