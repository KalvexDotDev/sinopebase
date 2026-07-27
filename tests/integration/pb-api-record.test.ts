/**
 * PocketBase-native Record CRUD & Auth API Tests
 *
 * Tests for record_crud.ts, record_auth.ts, and record_helpers.ts handlers.
 */

import { describe, expect, it } from 'bun:test'
import { createRecordAuthPlugin } from '../../src/apis/record_auth'
import { createRecordCrudPlugin } from '../../src/apis/record_crud'
import type { RequestAuthInfo } from '../../src/apis/record_helpers'
import { Collection } from '../../src/core/collection_model'
import { MemoryDatabase } from '../../src/core/db-memory'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Loose test-response accessor — narrower than `any`. */
interface TestResponse {
  items?: unknown
  page?: unknown
  perPage?: unknown
  totalItems?: unknown
  totalPages?: unknown
  name?: unknown
  type?: unknown
  id?: unknown
  email?: unknown
  verified?: unknown
  role?: unknown
  code?: unknown
  message?: unknown
  data?: unknown
  token?: unknown
  record?: unknown
  [key: string]: unknown
}
// ---------------------------------------------------------------------------

function makeAuthResolver(auth: Partial<RequestAuthInfo> = {}) {
  return async (): Promise<RequestAuthInfo> => ({
    record: null,
    isSuperuser: false,
    hasCollectionAuth: true,
    ...auth,
  })
}

/** Simulate a request against an Elysia app. */
async function request(
  app: ReturnType<typeof createRecordCrudPlugin>,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
) {
  const url = new URL(`http://localhost${path}`)
  const req = new Request(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })

  const response = await app.handle(req)
  const status = response.status
  let data: unknown = null
  const text = await response.text()
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  return { status, data }
}

// ---------------------------------------------------------------------------
// Record CRUD Tests
// ---------------------------------------------------------------------------

describe('Record CRUD API', () => {
  const db = new MemoryDatabase()
  db.createTable('_collections')
  db.createTable('articles')

  // Insert a collection definition using MemoryDatabase API
  const articlesCollection = Collection.createBase('articles')
  articlesCollection.refreshId() // ensure unique id
  articlesCollection.listRule = ''
  articlesCollection.viewRule = ''
  articlesCollection.createRule = ''
  articlesCollection.updateRule = ''
  articlesCollection.deleteRule = ''

  articlesCollection.fields.add({
    id: 'f1',
    name: 'title',
    type: 'text',
    system: false,
    hidden: false,
    columnType: 'TEXT',
    settingsSchema: {},
  })
  articlesCollection.fields.add({
    id: 'f2',
    name: 'body',
    type: 'text',
    system: false,
    hidden: false,
    columnType: 'TEXT',
    settingsSchema: {},
  })

  db.insert('_collections', [articlesCollection.dbExport()])

  const auth = makeAuthResolver({ isSuperuser: true })
  const recordPlugin = createRecordCrudPlugin(db as TestResponse, auth)

  it('GET /api/collections/:collection/records — lists records (empty)', async () => {
    const { status, data } = await request(recordPlugin, 'GET', '/api/collections/articles/records')
    expect(status).toBe(200)
    const result = data as TestResponse
    expect(result.items).toBeInstanceOf(Array)
    expect(result.totalItems).toBe(0)
  })

  it('POST /api/collections/:collection/records — creates a record', async () => {
    const { status, data } = await request(
      recordPlugin,
      'POST',
      '/api/collections/articles/records',
      {
        title: 'Hello World',
        body: 'My first article',
      },
    )

    expect(status).toBe(201)
    const result = data as TestResponse
    expect(result.title).toBe('Hello World')
    expect(result.body).toBe('My first article')
  })

  it('GET /api/collections/:collection/records/:id — views a record', async () => {
    const createResp = await request(recordPlugin, 'POST', '/api/collections/articles/records', {
      title: 'View Test',
      body: 'Can you see me?',
    })
    const recordId = (createResp.data as TestResponse).id

    const { status, data } = await request(
      recordPlugin,
      'GET',
      `/api/collections/articles/records/${recordId}`,
    )
    expect(status).toBe(200)
    expect((data as TestResponse).title).toBe('View Test')
  })

  it('GET /api/collections/:collection/records/:id — returns 404 for missing', async () => {
    const { status } = await request(
      recordPlugin,
      'GET',
      '/api/collections/articles/records/nonexistent',
    )
    expect(status).toBe(404)
  })

  it('PATCH /api/collections/:collection/records/:id — updates a record', async () => {
    const createResp = await request(recordPlugin, 'POST', '/api/collections/articles/records', {
      title: 'Before',
      body: 'Old content',
    })
    const recordId = (createResp.data as TestResponse).id

    const { status, data } = await request(
      recordPlugin,
      'PATCH',
      `/api/collections/articles/records/${recordId}`,
      {
        title: 'After',
      },
    )
    expect(status).toBe(200)
    expect((data as TestResponse).title).toBe('After')
    expect((data as TestResponse).body).toBe('Old content')
  })

  it('DELETE /api/collections/:collection/records/:id — deletes a record', async () => {
    const createResp = await request(recordPlugin, 'POST', '/api/collections/articles/records', {
      title: 'To Delete',
    })
    const recordId = (createResp.data as TestResponse).id

    const { status } = await request(
      recordPlugin,
      'DELETE',
      `/api/collections/articles/records/${recordId}`,
    )
    expect(status).toBe(204)
  })

  it('returns 404 for unknown collection', async () => {
    const { status } = await request(recordPlugin, 'GET', '/api/collections/unknown/records')
    expect(status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Record CRUD with Access Rules
// ---------------------------------------------------------------------------

describe('Record CRUD with access rules', () => {
  it('blocks list when listRule is null (no access)', async () => {
    const db2 = new MemoryDatabase()
    db2.createTable('_collections')
    db2.createTable('secret')

    const secretCollection = Collection.createBase('secret')
    secretCollection.listRule = null
    db2.insert('_collections', [secretCollection.dbExport()])

    const plugin = createRecordCrudPlugin(db2 as TestResponse, makeAuthResolver())
    const { status } = await request(plugin, 'GET', '/api/collections/secret/records')
    expect(status).toBe(403)
  })

  it('allows public access when listRule is ""', async () => {
    const db3 = new MemoryDatabase()
    db3.createTable('_collections')
    db3.createTable('public_records')

    const publicCollection = Collection.createBase('public')
    publicCollection.name = 'public_records'
    publicCollection.listRule = ''
    db3.insert('_collections', [publicCollection.dbExport()])

    const plugin = createRecordCrudPlugin(db3 as TestResponse, makeAuthResolver())
    const { status } = await request(plugin, 'GET', '/api/collections/public_records/records')
    expect(status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// Record Auth Tests
// ---------------------------------------------------------------------------

describe('Record Auth API', () => {
  const db = new MemoryDatabase()
  db.createTable('_collections')
  db.createTable('users')
  db.createTable('pages')

  const authCollection = Collection.createAuth('users')
  authCollection.refreshId() // ensure unique id
  authCollection.listRule = ''
  authCollection.viewRule = ''
  authCollection.createRule = ''
  db.insert('_collections', [authCollection.dbExport()])

  // Add a non-auth collection for testing auth validation
  const baseCollection = Collection.createBase('pages')
  baseCollection.refreshId() // ensure unique id
  baseCollection.listRule = ''
  baseCollection.viewRule = ''
  db.insert('_collections', [baseCollection.dbExport()])

  const authPlugin = createRecordAuthPlugin(
    db as TestResponse,
    makeAuthResolver(),
    () => 'test-secret',
  )

  it('GET /api/collections/:collection/auth-methods — returns auth methods', async () => {
    const { status, data } = await request(
      authPlugin as TestResponse,
      'GET',
      '/api/collections/users/auth-methods',
    )
    expect(status).toBe(200)
    const result = data as TestResponse
    expect(result.password).toBeDefined()
    expect(result.password.enabled).toBe(true)
  })

  it('returns 404 for non-existent collection', async () => {
    const { status } = await request(
      authPlugin as TestResponse,
      'GET',
      '/api/collections/nonexistent/auth-methods',
    )
    expect(status).toBe(404)
  })

  it('returns 400 for non-auth collection', async () => {
    const { status } = await request(
      authPlugin as TestResponse,
      'GET',
      '/api/collections/pages/auth-methods',
    )
    expect(status).toBe(400)
  })
})
