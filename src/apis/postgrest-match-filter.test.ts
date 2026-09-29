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

/** A PostgresDatabase whose reader compiles filters instead of executing them. */
function databaseWithRecordingReader() {
  const db = new PostgresDatabase({ postgresUrl: 'postgres://unused:unused@127.0.0.1:1/unused' })
  const query = new RecordingQueryDouble()
  query.executorProvider = db.getWriter()
  // The route reads rows through the private `reader`; swap in the recording double.
  const readerSlot = db as unknown as {
    reader: { selectFrom: (table: string) => RecordingQueryDouble }
  }
  readerSlot.reader = { selectFrom: () => query }
  return { db, query }
}

async function requestVersionFilter(filter: string) {
  const { db, query } = databaseWithRecordingReader()
  const app = new Elysia()
  mountPostgrestRoutes(app, db as never)

  const response = await app.handle(
    new Request(`http://localhost/rest/v1/documents?version=${encodeURIComponent(filter)}`),
  )
  return { response, query }
}

/**
 * Every operator PostgREST can send, its query string, and the SQL + bind
 * parameters Sinopebase must produce. `match`/`imatch` pass the client pattern
 * through untouched: PostgreSQL regexes are unanchored.
 */
const sqlCases: Array<{ filter: string; sql: string; parameters?: unknown[] }> = [
  { filter: 'eq.3', sql: '"version" = $1', parameters: ['3'] },
  { filter: 'neq.3', sql: '"version" <> $1', parameters: ['3'] },
  { filter: 'neq.null', sql: '"version" IS NOT NULL' },
  { filter: 'gt.3', sql: '"version" > $1', parameters: ['3'] },
  { filter: 'gte.3', sql: '"version" >= $1', parameters: ['3'] },
  { filter: 'lt.3', sql: '"version" < $1', parameters: ['3'] },
  { filter: 'lte.3', sql: '"version" <= $1', parameters: ['3'] },
  { filter: 'like.%v%', sql: '"version" LIKE $1', parameters: ['%v%'] },
  { filter: 'ilike.%v%', sql: '"version" ILIKE $1', parameters: ['%v%'] },
  { filter: 'match.^[1-9][0-9]{0,8}$', sql: '"version" ~ $1', parameters: ['^[1-9][0-9]{0,8}$'] },
  { filter: 'imatch.v3', sql: '"version" ~* $1', parameters: ['v3'] },
  { filter: 'is.null', sql: '"version" IS NULL' },
  { filter: 'is.true', sql: '"version" IS TRUE' },
  { filter: 'is.false', sql: '"version" IS FALSE' },
  { filter: 'in.(3,10)', sql: '"version" IN ($1, $2)', parameters: ['3', '10'] },
  { filter: 'in.()', sql: 'FALSE' },
  { filter: 'cs.{"a":1}', sql: '"version" @> $1::jsonb', parameters: ['{"a":1}'] },
  { filter: 'cd.{"a":1}', sql: '"version" <@ $1::jsonb', parameters: ['{"a":1}'] },
  {
    filter: 'fts.three',
    sql: `to_tsvector('english', "version") @@ plainto_tsquery('english', $1)`,
    parameters: ['three'],
  },
  {
    filter: 'plfts.three',
    sql: `to_tsvector('english', "version") @@ plainto_tsquery('english', $1)`,
    parameters: ['three'],
  },
  {
    filter: 'phfts.three',
    sql: `to_tsvector('english', "version") @@ phraseto_tsquery('english', $1)`,
    parameters: ['three'],
  },
  {
    filter: 'wfts.three',
    sql: `to_tsvector('english', "version") @@ websearch_to_tsquery('english', $1)`,
    parameters: ['three'],
  },
  { filter: 'not.eq.3', sql: 'NOT ("version" = $1)', parameters: ['3'] },
]

describe('PostgREST filter operators', () => {
  for (const { filter, sql, parameters } of sqlCases) {
    it(`compiles ${filter}`, async () => {
      const { response, query } = await requestVersionFilter(filter)

      expect(response.status).toBe(200)
      expect(query.compiledSql).toBe(sql)
      expect(query.compiledParameters).toEqual(parameters ?? [])
    })
  }

  it('rejects an unknown operator and an invalid is value', async () => {
    const unknown = await requestVersionFilter('bogus.3')
    expect(unknown.response.status).toBe(500)
    expect(await unknown.response.text()).toBe('Unsupported filter operator: bogus')

    const invalidIs = await requestVersionFilter('is.maybe')
    expect(invalidIs.response.status).toBe(500)
    expect(await invalidIs.response.text()).toBe('Unsupported is-filter value: maybe')
  })
})

describe('PostgresDatabase filter expressions', () => {
  it('binds array and scalar in values without wrapping them', async () => {
    const list = databaseWithRecordingReader()
    await list.db.select('documents', {
      filters: [{ column: 'version', operator: 'in', value: ['3', '10'] }],
    })
    expect(list.query.compiledSql).toBe('"version" IN ($1, $2)')
    expect(list.query.compiledParameters).toEqual(['3', '10'])

    const scalar = databaseWithRecordingReader()
    await scalar.db.select('documents', {
      filters: [{ column: 'version', operator: 'in', value: 3 }],
    })
    expect(scalar.query.compiledSql).toBe('"version" IN ($1)')
    expect(scalar.query.compiledParameters).toEqual([3])
  })

  it('treats a null neq value and a comma-bearing in element literally', async () => {
    const nullValue = databaseWithRecordingReader()
    await nullValue.db.select('documents', {
      filters: [{ column: 'version', operator: 'neq', value: null }],
    })
    expect(nullValue.query.compiledSql).toBe('"version" IS NOT NULL')

    const comma = databaseWithRecordingReader()
    await comma.db.select('documents', {
      filters: [{ column: 'version', operator: 'in', value: ['a,b'] }],
    })
    expect(comma.query.compiledSql).toBe('"version" IN ($1)')
    expect(comma.query.compiledParameters).toEqual(['a,b'])
  })
})
