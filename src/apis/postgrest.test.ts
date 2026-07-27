import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { MemoryDatabase } from '../core/db-memory'
import { MemoryDatabaseAdapter } from '../core/db-memory-adapter'
import { mountPostgrestRoutes } from './postgrest'

const singularMediaType = 'application/vnd.pgrst.object+json'

function createApp(rows: Record<string, unknown>[]) {
  const memDb = new MemoryDatabase()
  memDb.insert('items', rows)
  const db = new MemoryDatabaseAdapter(memDb)

  const app = new Elysia()
  mountPostgrestRoutes(app, db)
  return app
}

async function get(app: Elysia, path: string, headers: Record<string, string> = {}) {
  const response = await app.handle(new Request(`http://localhost${path}`, { headers }))
  return {
    response,
    body: await response.json(),
  }
}

describe('PostgREST singular responses', () => {
  it('returns an object for exactly one row', async () => {
    const app = createApp([{ id: 'one', rank: 1 }])

    const { response, body } = await get(app, '/rest/v1/items?id=eq.one', {
      accept: singularMediaType,
    })

    expect(response.status).toBe(200)
    expect(body).toEqual({ id: 'one', rank: 1 })
  })

  it('returns PGRST116 when no rows match', async () => {
    const app = createApp([{ id: 'one', rank: 1 }])

    const { response, body } = await get(app, '/rest/v1/items?id=eq.missing', {
      accept: singularMediaType,
    })

    expect(response.status).toBe(406)
    expect(body).toMatchObject({ code: 'PGRST116' })
  })

  it('returns PGRST116 when multiple rows match', async () => {
    const app = createApp([
      { id: 'one', rank: 1 },
      { id: 'two', rank: 2 },
    ])

    const { response, body } = await get(app, '/rest/v1/items', {
      accept: singularMediaType,
    })

    expect(response.status).toBe(406)
    expect(body).toMatchObject({ code: 'PGRST116' })
  })

  it('returns an object for a mutation followed by single()', async () => {
    const inserted = { id: 'created', rank: 4 }
    const db = {
      insert: async () => inserted,
    }
    const app = new Elysia()
    mountPostgrestRoutes(app, db as never)

    const response = await app.handle(
      new Request('http://localhost/rest/v1/items', {
        method: 'POST',
        headers: {
          accept: singularMediaType,
          'content-type': 'application/json',
          prefer: 'return=representation',
        },
        body: JSON.stringify({ rank: 4 }),
      }),
    )

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual(inserted)
  })
})

describe('PostgREST ordering', () => {
  it('applies the order query before returning rows', async () => {
    const app = createApp([
      { id: 'one', rank: 1 },
      { id: 'three', rank: 3 },
      { id: 'two', rank: 2 },
    ])

    const { response, body } = await get(app, '/rest/v1/items?order=rank.desc')

    expect(response.status).toBe(200)
    expect((body as { rank: number }[]).map(({ rank }) => rank)).toEqual([3, 2, 1])
  })

  it('translates order into the PostgreSQL database order shape', async () => {
    let capturedOrder: unknown
    const db = {
      select: async (_table: string, options: { order?: unknown }) => {
        capturedOrder = options.order
        return [
          { id: 'three', rank: 3 },
          { id: 'one', rank: 1 },
        ]
      },
    }
    const app = new Elysia()
    mountPostgrestRoutes(app, db as never)

    const { response } = await get(app, '/rest/v1/items?order=rank.desc')

    expect(response.status).toBe(200)
    expect(capturedOrder).toEqual([{ column: 'rank', direction: 'desc' }])
  })
})

interface TestRelationship {
  constraintName: string
  sourceTable: string
  sourceColumn: string
  targetTable: string
  targetColumn: string
}

function createRelationshipApp(
  tables: Record<string, Record<string, unknown>[]>,
  relationships: TestRelationship[],
) {
  const db = {
    select: async (
      table: string,
      options: { filters?: { column: string; operator: string; value: unknown }[] },
    ) => {
      let rows = tables[table] ?? []
      for (const filter of options.filters ?? []) {
        if (filter.operator === 'in') {
          const values = Array.isArray(filter.value) ? filter.value : [filter.value]
          rows = rows.filter((row) => values.includes(row[filter.column]))
        } else if (filter.operator === 'eq') {
          rows = rows.filter((row) => row[filter.column] === filter.value)
        }
      }
      return rows
    },
    getForeignKeyRelationships: async (table: string) =>
      relationships.filter(
        ({ sourceTable, targetTable }) => sourceTable === table || targetTable === table,
      ),
  }

  const app = new Elysia()
  mountPostgrestRoutes(app, db as never)
  return app
}

describe('PostgREST embedded relationships', () => {
  it('embeds an outbound relationship selected by referenced table', async () => {
    const app = createRelationshipApp(
      {
        certifications: [{ id: 'cert-1', framework_id: 'framework-1', ignored: true }],
        frameworks: [{ id: 'framework-1', name: 'ISO 27001', version: '2022', ignored: true }],
      },
      [
        {
          constraintName: 'certifications_framework_id_fkey',
          sourceTable: 'certifications',
          sourceColumn: 'framework_id',
          targetTable: 'frameworks',
          targetColumn: 'id',
        },
      ],
    )

    const { body } = await get(
      app,
      '/rest/v1/certifications?select=id,framework_id,frameworks(id,name,version)',
    )

    expect(body).toEqual([
      {
        id: 'cert-1',
        framework_id: 'framework-1',
        frameworks: { id: 'framework-1', name: 'ISO 27001', version: '2022' },
      },
    ])
  })

  it('filters parent rows for !inner embeds', async () => {
    const app = createRelationshipApp(
      {
        certification_controls: [
          { id: 'cc-1', control_id: 'control-1' },
          { id: 'cc-2', control_id: 'missing-control' },
        ],
        controls: [{ id: 'control-1', domain: 'A', control_id: 'A.1', control_name: 'Policy' }],
      },
      [
        {
          constraintName: 'certification_controls_control_id_fkey',
          sourceTable: 'certification_controls',
          sourceColumn: 'control_id',
          targetTable: 'controls',
          targetColumn: 'id',
        },
      ],
    )

    const { body } = await get(
      app,
      '/rest/v1/certification_controls?select=id,controls!inner(id,domain,control_id,control_name)',
    )

    expect(body).toEqual([
      {
        id: 'cc-1',
        controls: { id: 'control-1', domain: 'A', control_id: 'A.1', control_name: 'Policy' },
      },
    ])
  })

  it('uses a foreign-key column as an aliased relationship hint', async () => {
    const app = createRelationshipApp(
      {
        control_evidence: [{ certification_control_id: 'cc-1', evidence_id: 'evidence-1' }],
        evidence: [{ id: 'evidence-1', file_name: 'policy.pdf', storage_path: '/policy.pdf' }],
      },
      [
        {
          constraintName: 'control_evidence_evidence_id_fkey',
          sourceTable: 'control_evidence',
          sourceColumn: 'evidence_id',
          targetTable: 'evidence',
          targetColumn: 'id',
        },
      ],
    )

    const { body } = await get(
      app,
      '/rest/v1/control_evidence?select=certification_control_id,evidence:evidence_id(id,file_name,storage_path)',
    )

    expect(body).toEqual([
      {
        certification_control_id: 'cc-1',
        evidence: { id: 'evidence-1', file_name: 'policy.pdf', storage_path: '/policy.pdf' },
      },
    ])
  })

  it('embeds an incoming relationship as an array', async () => {
    const app = createRelationshipApp(
      {
        frameworks: [{ id: 'framework-1', name: 'ISO 27001' }],
        certifications: [
          { id: 'cert-1', framework_id: 'framework-1' },
          { id: 'cert-2', framework_id: 'framework-1' },
        ],
      },
      [
        {
          constraintName: 'certifications_framework_id_fkey',
          sourceTable: 'certifications',
          sourceColumn: 'framework_id',
          targetTable: 'frameworks',
          targetColumn: 'id',
        },
      ],
    )

    const { body } = await get(app, '/rest/v1/frameworks?select=id,certifications(id)')

    expect(body).toEqual([
      {
        id: 'framework-1',
        certifications: [{ id: 'cert-1' }, { id: 'cert-2' }],
      },
    ])
  })
})
