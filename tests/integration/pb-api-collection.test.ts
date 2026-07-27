/**
 * PocketBase-native Collection API Tests
 *
 * Tests for collection.ts and collection_import.ts handlers.
 */

import { describe, expect, it } from 'bun:test'
import { createCollectionPlugin } from '../../src/apis/collection'
import { createCollectionImportPlugin } from '../../src/apis/collection_import'
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
  schema?: unknown
  fields?: unknown
  rules?: unknown
  code?: unknown
  message?: unknown
  [key: string]: unknown
}

/** Simulate a request against an Elysia app. */
async function request(
  app: ReturnType<typeof createCollectionPlugin>,
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
// Collection CRUD Tests
// ---------------------------------------------------------------------------

describe('Collection API', () => {
  const db = new MemoryDatabase()
  db.createTable('_collections')

  const collectionPlugin = createCollectionPlugin(db as TestResponse, () => true)
  let createdId = ''

  it('GET /api/collections — lists collections (empty)', async () => {
    const { status, data } = await request(collectionPlugin, 'GET', '/api/collections')
    expect(status).toBe(200)
    const result = data as TestResponse
    expect(result.items).toBeInstanceOf(Array)
    expect(result.items.length).toBe(0)
    expect(result.page).toBe(1)
  })

  it('POST /api/collections — creates a collection', async () => {
    const { status, data } = await request(collectionPlugin, 'POST', '/api/collections', {
      name: 'articles',
      type: 'base',
      listRule: '',
      createRule: '',
    })

    expect(status).toBe(200)
    const result = data as TestResponse
    expect(result.name).toBe('articles')
    expect(result.type).toBe('base')
    expect(result.id).toBeTruthy()
    createdId = result.id
  })

  it('GET /api/collections/:id — views a collection', async () => {
    const { status, data } = await request(collectionPlugin, 'GET', `/api/collections/${createdId}`)
    expect(status).toBe(200)
    const result = data as TestResponse
    expect(result.name).toBe('articles')
    expect(result.id).toBe(createdId)
  })

  it('GET /api/collections/:id — returns 404 for missing', async () => {
    const { status } = await request(collectionPlugin, 'GET', '/api/collections/nonexistent')
    expect(status).toBe(404)
  })

  it('PATCH /api/collections/:id — updates a collection', async () => {
    const { status, data } = await request(
      collectionPlugin,
      'PATCH',
      `/api/collections/${createdId}`,
      {
        name: 'posts',
      },
    )

    expect(status).toBe(200)
    const result = data as TestResponse
    expect(result.name).toBe('posts')
  })

  it('DELETE /api/collections/:id — deletes a collection', async () => {
    // Create a new collection to delete
    const createResp = await request(collectionPlugin, 'POST', '/api/collections', {
      name: 'todelete',
      type: 'base',
    })
    const deleteId = (createResp.data as TestResponse).id

    const { status } = await request(collectionPlugin, 'DELETE', `/api/collections/${deleteId}`)
    expect(status).toBe(204)
  })

  it('blocks non-superusers from listing collections', async () => {
    const restrictedPlugin = createCollectionPlugin(
      new MemoryDatabase() as TestResponse,
      () => false,
    )
    const { status, data } = await request(restrictedPlugin, 'GET', '/api/collections')
    expect(status).toBe(403)
    expect((data as TestResponse).message).toContain('superuser')
  })

  it('blocks non-superusers from creating collections', async () => {
    const restrictedPlugin = createCollectionPlugin(
      new MemoryDatabase() as TestResponse,
      () => false,
    )
    const { status } = await request(restrictedPlugin, 'POST', '/api/collections', { name: 'nope' })
    expect(status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// Collection Import Tests
// ---------------------------------------------------------------------------

describe('Collection Import API', () => {
  const db = new MemoryDatabase()
  db.createTable('_collections')

  const importPlugin = createCollectionImportPlugin(db as TestResponse, () => true)

  it('POST /api/collections/import — imports collections', async () => {
    const { status } = await request(importPlugin, 'POST', '/api/collections/import', {
      collections: [{ id: 'import1', name: 'imported-posts', type: 'base' }],
      deleteMissing: false,
    })

    expect(status).toBe(204)
  })

  it('POST /api/collections/import — rejects empty collections array', async () => {
    const { status, data } = await request(importPlugin, 'POST', '/api/collections/import', {
      collections: [],
      deleteMissing: false,
    })
    expect(status).toBe(400)
    expect((data as TestResponse).message).toContain('required')
  })

  it('blocks non-superusers', async () => {
    const restrictedPlugin = createCollectionImportPlugin(
      new MemoryDatabase() as TestResponse,
      () => false,
    )
    const { status } = await request(restrictedPlugin, 'POST', '/api/collections/import', {
      collections: [{ name: 'test' }],
    })
    expect(status).toBe(403)
  })
})
