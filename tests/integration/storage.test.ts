/**
 * Storage ATDD Tests
 *
 * Ported from supabase-js test/integration.test.ts (Storage block).
 * These drive implementation of MinIO-backed /storage/v1 endpoints.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Sinopebase } from '../../src/core/app'
import { createClient, type SinopebaseClient } from '../../src/sdk/client'
import {
  createTestNamespace,
  requireAnonKey,
  requirePostgres,
  requireRustFS,
  requireServiceRoleKey,
  reserveLoopbackPort,
} from '../harness'
import { uniqueId } from './setup'

let client: SinopebaseClient
let server: Sinopebase
let testBucket: string
const namespace = createTestNamespace({ suiteId: 'storage' })

beforeAll(async () => {
  testBucket = namespace.storageBucket('test')
  const portReservation = await reserveLoopbackPort()
  const { endpoint, accessKey, secretKey } = requireRustFS()
  server = new Sinopebase({
    postgresUrl: requirePostgres(),
    minioEndpoint: endpoint,
    minioAccessKey: accessKey,
    minioSecretKey: secretKey,
    port: portReservation.port,
    jwtSecret: 'storagetest-jwt-secret-min-32-chars!!',
    serviceRoleKey: 'storagetest-service-key-min-32-chars!!!',
    anonKey: 'storagetest-anon-key-min-32-chars!!!!',
  })
  await portReservation.release()
  await server.start()
  client = createClient(portReservation.origin, 'storagetest-anon-key-min-32-chars!!!!')

  // Provision the test bucket via the service-role client so the bucket
  // exists in both the storage metadata schema (storage.buckets) and the
  // RustFS/S3 backend. The anon-key client cannot CREATE buckets (RLS).
  const admin = createClient(portReservation.origin, 'storagetest-service-key-min-32-chars!!!')
  const { error: createError } = await admin.storage.createBucket(testBucket, { public: true })
  if (createError) {
    throw new Error(`Failed to create test bucket: ${createError.message}`)
  }
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
    const { data: uploadData, error: uploadError } = await client.storage
      .from(testBucket)
      .upload(testPath, file, { upsert: true })

    expect(uploadError).toBeNull()
    expect(uploadData).not.toBeNull()
    expect(uploadData?.path).toBe(testPath)

    // List
    const { data: listData, error: listError } = await client.storage.from(testBucket).list()

    expect(listError).toBeNull()
    expect(listData).not.toBeNull()
    const found = listData?.find((f) => f.name === testPath)
    expect(found).toBeTruthy()

    // Download
    const { data: downloadData, error: downloadError } = await client.storage
      .from(testBucket)
      .download(testPath)

    expect(downloadError).toBeNull()
    expect(downloadData).not.toBeNull()
    const downloadedText = await (downloadData as Blob).text()
    expect(downloadedText).toBe(testContent)

    // Remove
    const { data: removeData, error: removeError } = await client.storage
      .from(testBucket)
      .remove([testPath])

    expect(removeError).toBeNull()
    expect(removeData).not.toBeNull()
    expect(removeData?.some((r) => r.path === testPath)).toBe(true)

    // Verify gone
    const { data: afterRemove } = await client.storage.from(testBucket).list()

    const stillThere = afterRemove?.find((f) => f.name === testPath)
    expect(stillThere).toBeFalsy()
  })

  it('getPublicUrl() — returns accessible URL', async () => {
    const { data } = client.storage.from(testBucket).getPublicUrl('test-file.txt')

    expect(data.publicUrl).toContain(testBucket)
    expect(data.publicUrl).toContain('test-file.txt')
  })

  it('listBuckets() — returns buckets', async () => {
    const { data, error } = await client.storage.listBuckets()

    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })
})
