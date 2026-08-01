/**
 * PostgREST filter system — parametric contract tests
 *
 * Exercises the filter contract through the /rest/v1/:table route layer over
 * the in-memory database (the same contract the PostgreSQL backend implements):
 *
 *   1. Operator matrix: eq/neq/gt/gte/lt/lte/like/ilike/is/in × GET/PATCH/DELETE
 *   2. neq.null  → IS NOT NULL  semantics
 *   3. is.null   → IS NULL      semantics
 *   4. or=(...)  in PATCH/DELETE mutates only matching rows
 *   5. in filter with double-quoted comma values ("a,b" is one value)
 *   6. Prefer: count=planned/estimated → Content-Range header
 *   7. Empty results per operator
 *   8. Type coercion edge cases (numeric strings, booleans, wildcards)
 */

import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { mountPostgrestRoutes } from '../../src/apis/postgrest'
import { MemoryDatabase } from '../../src/core/db-memory'
import { MemoryDatabaseAdapter } from '../../src/core/db-memory-adapter'

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

function createApp(rows: Record<string, unknown>[]) {
  const memDb = new MemoryDatabase()
  memDb.createTable('items')
  memDb.insert('items', rows)
  const db = new MemoryDatabaseAdapter(memDb)

  const app = new Elysia()
  mountPostgrestRoutes(app, db)
  return app
}

function restUrl(path: string, query: Record<string, string> = {}): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    params.set(key, value)
  }
  const qs = params.toString()
  return `http://localhost/rest/v1/${path}${qs ? `?${qs}` : ''}`
}

async function requestJson(
  app: Elysia,
  path: string,
  query: Record<string, string>,
  init: RequestInit = {},
) {
  const response = await app.handle(new Request(restUrl(path, query), init))
  const text = await response.text()
  const body = text ? (JSON.parse(text) as Record<string, unknown>[]) : []
  return { response, body }
}

async function get(
  app: Elysia,
  path: string,
  query: Record<string, string> = {},
  headers: Record<string, string> = {},
) {
  return requestJson(app, path, query, { headers })
}

async function patch(
  app: Elysia,
  path: string,
  query: Record<string, string>,
  data: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return requestJson(app, path, query, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(data),
  })
}

async function del(app: Elysia, path: string, query: Record<string, string> = {}) {
  return requestJson(app, path, query, { method: 'DELETE' })
}

const idsOf = (rows: Record<string, unknown>[]) => rows.map((row) => String(row.id)).sort()

// ---------------------------------------------------------------------------
// Dataset + operator matrix
// ---------------------------------------------------------------------------

const MATRIX_ROWS: Record<string, unknown>[] = [
  { id: 'a1', name: 'alpha', rank: 1, active: true, note: null, category: 'x' },
  { id: 'b2', name: 'bravo', rank: 2, active: false, note: 'hello', category: 'x' },
  { id: 'c3', name: 'charlie', rank: 3, active: true, note: 'world', category: 'y' },
  { id: 'd4', name: 'delta', rank: 4, active: false, note: null, category: 'y' },
]

const ALL_IDS = ['a1', 'b2', 'c3', 'd4']

interface FilterCase {
  operator: string
  query: Record<string, string>
  expected: string[]
}

const FILTER_CASES: FilterCase[] = [
  { operator: 'eq', query: { rank: 'eq.2' }, expected: ['b2'] },
  { operator: 'neq', query: { rank: 'neq.2' }, expected: ['a1', 'c3', 'd4'] },
  { operator: 'gt', query: { rank: 'gt.2' }, expected: ['c3', 'd4'] },
  { operator: 'gte', query: { rank: 'gte.3' }, expected: ['c3', 'd4'] },
  { operator: 'lt', query: { rank: 'lt.3' }, expected: ['a1', 'b2'] },
  { operator: 'lte', query: { rank: 'lte.2' }, expected: ['a1', 'b2'] },
  { operator: 'like', query: { name: 'like.al_ha' }, expected: ['a1'] },
  { operator: 'ilike', query: { name: 'ilike.AL_HA' }, expected: ['a1'] },
  { operator: 'is', query: { active: 'is.true' }, expected: ['a1', 'c3'] },
  { operator: 'in', query: { rank: 'in.(1,3)' }, expected: ['a1', 'c3'] },
]

describe('PostgREST filter operator matrix', () => {
  for (const c of FILTER_CASES) {
    it(`GET ${c.operator} selects only matching rows`, async () => {
      const app = createApp(MATRIX_ROWS)
      const { response, body } = await get(app, 'items', c.query)

      expect(response.status).toBe(200)
      expect(idsOf(body)).toEqual([...c.expected].sort())
    })

    it(`PATCH ${c.operator} updates only matching rows`, async () => {
      const app = createApp(MATRIX_ROWS)
      const { response, body } = await patch(app, 'items', c.query, { category: 'patched' })

      expect(response.status).toBe(200)
      expect(idsOf(body)).toEqual([...c.expected].sort())

      const { body: patched } = await get(app, 'items', { category: 'eq.patched' })
      expect(idsOf(patched)).toEqual([...c.expected].sort())
    })

    it(`DELETE ${c.operator} deletes only matching rows`, async () => {
      const app = createApp(MATRIX_ROWS)
      const { response, body } = await del(app, 'items', c.query)

      expect(response.status).toBe(200)
      expect(idsOf(body)).toEqual([...c.expected].sort())

      const { body: remaining } = await get(app, 'items')
      expect(idsOf(remaining)).toEqual(ALL_IDS.filter((id) => !c.expected.includes(id)))
    })
  }
})

// ---------------------------------------------------------------------------
// Null semantics: neq.null / is.null
// ---------------------------------------------------------------------------

describe('PostgREST null filter semantics', () => {
  it('GET neq.null returns rows where the column is not null', async () => {
    const app = createApp(MATRIX_ROWS)
    const { response, body } = await get(app, 'items', { note: 'neq.null' })

    expect(response.status).toBe(200)
    expect(idsOf(body)).toEqual(['b2', 'c3'])
  })

  it('GET is.null returns rows where the column is null', async () => {
    const app = createApp(MATRIX_ROWS)
    const { response, body } = await get(app, 'items', { note: 'is.null' })

    expect(response.status).toBe(200)
    expect(idsOf(body)).toEqual(['a1', 'd4'])
  })

  it('PATCH with neq.null updates only non-null rows', async () => {
    const app = createApp(MATRIX_ROWS)
    const { response, body } = await patch(
      app,
      'items',
      { note: 'neq.null' },
      { category: 'patched' },
    )

    expect(response.status).toBe(200)
    expect(idsOf(body)).toEqual(['b2', 'c3'])
  })

  it('DELETE with is.null deletes only null rows', async () => {
    const app = createApp(MATRIX_ROWS)
    const { response, body } = await del(app, 'items', { note: 'is.null' })

    expect(response.status).toBe(200)
    expect(idsOf(body)).toEqual(['a1', 'd4'])

    const { body: remaining } = await get(app, 'items')
    expect(idsOf(remaining)).toEqual(['b2', 'c3'])
  })
})

// ---------------------------------------------------------------------------
// or=(...) compound filters on GET/PATCH/DELETE
// ---------------------------------------------------------------------------

describe('PostgREST or filters', () => {
  it('GET or=(...) returns the union of conditions', async () => {
    const app = createApp(MATRIX_ROWS)
    const { response, body } = await get(app, 'items', { or: '(rank.eq.1,rank.eq.3)' })

    expect(response.status).toBe(200)
    expect(idsOf(body)).toEqual(['a1', 'c3'])
  })

  it('GET or=(...) combines conditions on different columns', async () => {
    const app = createApp(MATRIX_ROWS)
    const { response, body } = await get(app, 'items', { or: '(rank.eq.1,name.eq.delta)' })

    expect(response.status).toBe(200)
    expect(idsOf(body)).toEqual(['a1', 'd4'])
  })

  it('PATCH with or=(...) updates only rows matching any condition', async () => {
    const app = createApp(MATRIX_ROWS)
    const { response, body } = await patch(
      app,
      'items',
      { or: '(rank.eq.1,rank.eq.3)' },
      { category: 'patched' },
    )

    expect(response.status).toBe(200)
    expect(idsOf(body)).toEqual(['a1', 'c3'])

    const { body: patched } = await get(app, 'items', { category: 'eq.patched' })
    expect(idsOf(patched)).toEqual(['a1', 'c3'])

    // Verify non-matched rows are untouched
    const { body: all } = await get(app, 'items')
    expect(idsOf(all)).toEqual(['a1', 'b2', 'c3', 'd4'])
  })

  it('DELETE with or=(...) deletes only rows matching any condition', async () => {
    const app = createApp(MATRIX_ROWS)
    const { response, body } = await del(app, 'items', { or: '(rank.eq.1,rank.eq.3)' })

    expect(response.status).toBe(200)
    expect(idsOf(body)).toEqual(['a1', 'c3'])

    const { body: remaining } = await get(app, 'items')
    expect(idsOf(remaining)).toEqual(['b2', 'd4'])
  })
})

// ---------------------------------------------------------------------------
// in filter with double-quoted comma values
// ---------------------------------------------------------------------------

const COMMA_ROWS: Record<string, unknown>[] = [
  { id: 'q1', name: 'a,b' },
  { id: 'q2', name: 'c' },
  { id: 'q3', name: 'a,b,c' },
]

describe('PostgREST in filter with quoted commas', () => {
  it('GET in.("a,b","c") treats the quoted comma as part of one value', async () => {
    const app = createApp(COMMA_ROWS)
    const { response, body } = await get(app, 'items', { name: 'in.("a,b","c")' })

    expect(response.status).toBe(200)
    expect(idsOf(body)).toEqual(['q1', 'q2'])
  })

  it('GET in.(a,b) without quotes treats commas as value separators', async () => {
    const app = createApp(COMMA_ROWS)
    const { response, body } = await get(app, 'items', { name: 'in.(a,b)' })

    expect(response.status).toBe(200)
    expect(body).toEqual([])
  })

  it('GET in.("a,b",c) supports a mix of quoted and bare values', async () => {
    const app = createApp(COMMA_ROWS)
    const { response, body } = await get(app, 'items', { name: 'in.("a,b",c)' })

    expect(response.status).toBe(200)
    expect(idsOf(body)).toEqual(['q1', 'q2'])
  })

  it('DELETE in.("a,b","c") deletes only matching rows', async () => {
    const app = createApp(COMMA_ROWS)
    const { response, body } = await del(app, 'items', { name: 'in.("a,b","c")' })

    expect(response.status).toBe(200)
    expect(idsOf(body)).toEqual(['q1', 'q2'])

    const { body: remaining } = await get(app, 'items')
    expect(idsOf(remaining)).toEqual(['q3'])
  })
})

// ---------------------------------------------------------------------------
// Prefer: count=planned / count=estimated
// ---------------------------------------------------------------------------

describe('PostgREST Prefer count=planned/estimated', () => {
  it('GET with count=planned returns rows and a Content-Range header', async () => {
    const app = createApp(MATRIX_ROWS)
    const { response, body } = await get(
      app,
      'items',
      { active: 'is.true' },
      { prefer: 'count=planned' },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-range')).toBe('*/2')
    expect(idsOf(body)).toEqual(['a1', 'c3'])
  })

  it('GET with count=estimated returns rows and a Content-Range header', async () => {
    const app = createApp(MATRIX_ROWS)
    const { response, body } = await get(
      app,
      'items',
      { active: 'is.true' },
      { prefer: 'count=estimated' },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-range')).toBe('*/2')
    expect(idsOf(body)).toEqual(['a1', 'c3'])
  })

  it('GET with count=exact returns the same Content-Range header', async () => {
    const app = createApp(MATRIX_ROWS)
    const { response } = await get(app, 'items', { active: 'is.true' }, { prefer: 'count=exact' })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-range')).toBe('*/2')
  })
})

// ---------------------------------------------------------------------------
// Empty results per operator
// ---------------------------------------------------------------------------

const EMPTY_ROWS: Record<string, unknown>[] = [
  { id: 'e1', status: 'on', rank: 5, active: false },
  { id: 'e2', status: 'on', rank: 6, active: false },
]

const EMPTY_CASES: FilterCase[] = [
  { operator: 'eq', query: { status: 'eq.off' }, expected: [] },
  { operator: 'neq', query: { status: 'neq.on' }, expected: [] },
  { operator: 'gt', query: { rank: 'gt.9' }, expected: [] },
  { operator: 'gte', query: { rank: 'gte.7' }, expected: [] },
  { operator: 'lt', query: { rank: 'lt.5' }, expected: [] },
  { operator: 'lte', query: { rank: 'lte.4' }, expected: [] },
  { operator: 'like', query: { status: 'like.off' }, expected: [] },
  { operator: 'ilike', query: { status: 'ilike.OFF' }, expected: [] },
  { operator: 'is', query: { active: 'is.true' }, expected: [] },
  { operator: 'in', query: { rank: 'in.(1,2)' }, expected: [] },
]

describe('PostgREST empty results per operator', () => {
  for (const c of EMPTY_CASES) {
    it(`GET ${c.operator} with no matching rows returns an empty array`, async () => {
      const app = createApp(EMPTY_ROWS)
      const { response, body } = await get(app, 'items', c.query)

      expect(response.status).toBe(200)
      expect(body).toEqual([])
    })
  }

  it('PATCH with a non-matching filter updates nothing', async () => {
    const app = createApp(EMPTY_ROWS)
    const { response, body } = await patch(app, 'items', { status: 'eq.off' }, { status: 'on' })

    expect(response.status).toBe(200)
    expect(body).toEqual([])

    const { body: after } = await get(app, 'items')
    expect(idsOf(after)).toEqual(['e1', 'e2'])
  })

  it('DELETE with a non-matching filter deletes nothing', async () => {
    const app = createApp(EMPTY_ROWS)
    const { response, body } = await del(app, 'items', { status: 'eq.off' })

    expect(response.status).toBe(200)
    expect(body).toEqual([])

    const { body: after } = await get(app, 'items')
    expect(idsOf(after)).toEqual(['e1', 'e2'])
  })
})

// ---------------------------------------------------------------------------
// Type coercion edge cases
// ---------------------------------------------------------------------------

describe('PostgREST type coercion edge cases', () => {
  it('eq matches both numbers and numeric strings', async () => {
    const app = createApp([
      { id: 'n1', rank: 1 },
      { id: 's1', rank: '1' },
    ])
    const { response, body } = await get(app, 'items', { rank: 'eq.1' })

    expect(response.status).toBe(200)
    expect(idsOf(body)).toEqual(['n1', 's1'])
  })

  it('gt compares numerically, not lexicographically', async () => {
    const app = createApp([
      { id: 'two', rank: 2 },
      { id: 'ten', rank: 10 },
    ])
    const { response, body } = await get(app, 'items', { rank: 'gt.2' })

    expect(response.status).toBe(200)
    expect(idsOf(body)).toEqual(['ten'])
  })

  it('in matches mixed number and string values', async () => {
    const app = createApp([
      { id: 'n1', rank: 1 },
      { id: 's2', rank: '2' },
    ])
    const { response, body } = await get(app, 'items', { rank: 'in.(1,2)' })

    expect(response.status).toBe(200)
    expect(idsOf(body)).toEqual(['n1', 's2'])
  })

  it('like _ wildcard matches exactly one character', async () => {
    const app = createApp([
      { id: 'al', name: 'alpha' },
      { id: 'ao', name: 'aloha' },
      { id: 'no', name: 'alha' },
    ])
    const { response, body } = await get(app, 'items', { name: 'like.al_ha' })

    expect(response.status).toBe(200)
    expect(idsOf(body)).toEqual(['al', 'ao'])
  })
})
