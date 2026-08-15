/**
 * storage.exists() — only 404 means "not found"; auth and server failures
 * must not fail open.
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { createStorageClient } from '~/sdk/storage-impl'

const realFetch = globalThis.fetch

function stubFetch(status: number, statusText = ''): void {
  globalThis.fetch = (async () => new Response(null, { status, statusText })) as typeof fetch
}

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('storage.exists()', () => {
  it('reports true on 200', async () => {
    stubFetch(200)
    const { data, error } = await createStorageClient('http://x', 'key')
      .from('b')
      .exists('file.txt')
    expect(error).toBeNull()
    expect(data).toBe(true)
  })

  it('reports false on 404', async () => {
    stubFetch(404)
    const { data, error } = await createStorageClient('http://x', 'key')
      .from('b')
      .exists('file.txt')
    expect(error).toBeNull()
    expect(data).toBe(false)
  })

  it('returns an error on 403', async () => {
    stubFetch(403, 'Forbidden')
    const { data, error } = await createStorageClient('http://x', 'key')
      .from('b')
      .exists('file.txt')
    expect(data).toBeNull()
    expect(error?.code).toBe('403')
  })

  it('returns an error on 500', async () => {
    stubFetch(500)
    const { data, error } = await createStorageClient('http://x', 'key')
      .from('b')
      .exists('file.txt')
    expect(data).toBeNull()
    expect(error?.code).toBe('500')
  })
})
