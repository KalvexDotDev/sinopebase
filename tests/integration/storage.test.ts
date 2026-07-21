/**
 * Storage ATDD Tests
 *
 * Ported from supabase-js test/integration.test.ts (Storage block).
 * These drive implementation of MinIO-backed /storage/v1 endpoints.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { createTestClient, TEST_BUCKET, uniqueId } from './setup'
import type { SinopebaseClient } from '../../src/sdk/client'
import { Sinopebase } from '../../src/core/app'

let client: SinopebaseClient
let server: Sinopebase

beforeAll(async () => {
  server = new Sinopebase({ postgresUrl: '', minioEndpoint: '', minioAccessKey: '', minioSecretKey: '', port: 8090 })
  await server.start()
  client = createTestClient()
})

afterAll(async () => {
  await server.stop()
})

describe('Storage', () => {
  it('upload() + list() + remove() — full file lifecycle', async () => {
    const testContent = `Hello Sinopebase storage test - ${uniqueId()}`
    const testPath = `test-file-${uniqueId()}.txt`
    const file = new Blob([testContent], { type: 'text/plain' })

    // Upload
    const { data: uploadData, error: uploadError } = await client
      .storage
      .from(TEST_BUCKET)
      .upload(testPath, file, { upsert: true })

    expect(uploadError).toBeNull()
    expect(uploadData).not.toBeNull()
    expect(uploadData!.path).toBe(testPath)

    // List
    const { data: listData, error: listError } = await client
      .storage
      .from(TEST_BUCKET)
      .list()

    expect(listError).toBeNull()
    expect(listData).not.toBeNull()
    const found = listData!.find((f) => f.name === testPath)
    expect(found).toBeTruthy()

    // Download
    const { data: downloadData, error: downloadError } = await client
      .storage
      .from(TEST_BUCKET)
      .download(testPath)

    expect(downloadError).toBeNull()
    expect(downloadData).not.toBeNull()
    const downloadedText = await (downloadData as Blob).text()
    expect(downloadedText).toBe(testContent)

    // Remove
    const { data: removeData, error: removeError } = await client
      .storage
      .from(TEST_BUCKET)
      .remove([testPath])

    expect(removeError).toBeNull()
    expect(removeData).not.toBeNull()
    expect(removeData!.some((r) => r.path === testPath)).toBe(true)

    // Verify gone
    const { data: afterRemove } = await client
      .storage
      .from(TEST_BUCKET)
      .list()

    const stillThere = afterRemove!.find((f) => f.name === testPath)
    expect(stillThere).toBeFalsy()
  })

  it('getPublicUrl() — returns accessible URL', async () => {
    const { data } = client
      .storage
      .from(TEST_BUCKET)
      .getPublicUrl('test-file.txt')

    expect(data.publicUrl).toContain(TEST_BUCKET)
    expect(data.publicUrl).toContain('test-file.txt')
  })

  it('listBuckets() — returns buckets', async () => {
    const { data, error } = await client.storage.listBuckets()

    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })
})
