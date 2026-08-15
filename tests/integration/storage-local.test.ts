/**
 * Storage ATDD Tests — local file store (no RustFS, no PostgreSQL)
 *
 * The existing storage.test.ts requires RustFS/MinIO. This suite drives the
 * same /storage/v1 endpoints against the local-filesystem fallback
 * (Sinopebase boots with no minioEndpoint), so the storage contract is
 * testable without S3 infrastructure.
 *
 * These tests pin the storage gaps found by the codex audit: MIME inference,
 * range requests, copy, move, exists, and bucket-name validation.
 *
 * ponytail: the server repeats the same "invalid bucket name" 400 block in
 * four routes (list, upload, public, sign) in src/apis/file.ts — a shared
 * validateBucketRoute helper would remove the duplication.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient, type SinopebaseClient } from '~/sdk/client'
import { Sinopebase } from '../../src/core/app'
import { reserveLoopbackPort } from '../harness'
import { uniqueId } from './setup'

const JWT_SECRET = 'storagelocal-jwt-secret-min-32-chars!!'
const SERVICE_ROLE_KEY = 'storagelocal-service-key-min-32-chars!!!'
const ANON_KEY = 'storagelocal-anon-key-min-32-chars!!!!'

let client: SinopebaseClient
let server: Sinopebase
let origin: string
let dataDir: string
let testBucket: string

const authHeaders = {
  apikey: ANON_KEY,
  Authorization: `Bearer ${ANON_KEY}`,
}

// CI jobs export RUSTFS_* for other suites — this suite must pin the LOCAL
// store regardless of the ambient environment.
const savedRustfsEnv: Record<string, string | undefined> = {}

beforeAll(async () => {
  for (const key of ['RUSTFS_ENDPOINT', 'RUSTFS_ACCESS_KEY', 'RUSTFS_SECRET_KEY']) {
    savedRustfsEnv[key] = process.env[key]
    delete process.env[key]
  }
  // Unique bucket per run — no cross-run state, cleanup happens in afterAll.
  testBucket = `local-${uniqueId()}`
  dataDir = await mkdtemp(join(tmpdir(), 'sinope-storage-local-'))
  const portReservation = await reserveLoopbackPort()
  server = new Sinopebase({
    port: portReservation.port,
    dataDir,
    jwtSecret: JWT_SECRET,
    serviceRoleKey: SERVICE_ROLE_KEY,
    anonKey: ANON_KEY,
  })
  await portReservation.release()
  await server.start()
  origin = portReservation.origin
  client = createClient(origin, ANON_KEY)
})

afterAll(async () => {
  await server.stop()
  await rm(dataDir, { recursive: true, force: true })
  for (const [key, value] of Object.entries(savedRustfsEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('storage-local: upload/download with MIME inference', () => {
  it('downloads a .txt upload with text/plain content-type', async () => {
    const path = `hello-${uniqueId()}.txt`
    const { error: uploadError } = await client.storage
      .from(testBucket)
      .upload(path, new Blob(['hello local storage'], { type: 'text/plain' }))
    expect(uploadError).toBeNull()

    const { data: blob, error: downloadError } = await client.storage
      .from(testBucket)
      .download(path)
    expect(downloadError).toBeNull()
    expect(blob).not.toBeNull()
    expect((blob as Blob).type).toContain('text/plain')
    expect(await (blob as Blob).text()).toBe('hello local storage')
  })

  it('infers image/png from the .png extension, not the upload metadata', async () => {
    const path = `a-${uniqueId()}.png`
    // Uploaded with an unrelated content-type — the server must infer
    // image/png from the file extension on download.
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ])
    const { error: uploadError } = await client.storage
      .from(testBucket)
      .upload(path, new Blob([pngBytes], { type: 'application/octet-stream' }))
    expect(uploadError).toBeNull()

    const { data: blob, error: downloadError } = await client.storage
      .from(testBucket)
      .download(path)
    expect(downloadError).toBeNull()
    expect(blob).not.toBeNull()
    expect((blob as Blob).type).toBe('image/png')
    expect(await (blob as Blob).arrayBuffer()).toEqual(pngBytes.buffer)
  })
})

describe('storage-local: range requests', () => {
  it('returns 206 with the requested byte range', async () => {
    const path = `range-${uniqueId()}.txt`
    const content = '0123456789'
    const { error: uploadError } = await client.storage
      .from(testBucket)
      .upload(path, new Blob([content], { type: 'text/plain' }))
    expect(uploadError).toBeNull()

    // The SDK download does not send Range — raw fetch keeps this full-server.
    const res = await fetch(`${origin}/storage/v1/object/${testBucket}/${path}`, {
      headers: { ...authHeaders, Range: 'bytes=0-4' },
    })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe(`bytes 0-4/${content.length}`)
    expect(await res.text()).toBe('01234')
  })
})

describe('storage-local: copy', () => {
  it('copies an object to a new path with matching content', async () => {
    const from = `copy-src-${uniqueId()}.txt`
    const to = `copy-dst-${uniqueId()}.txt`
    const content = `copy me - ${uniqueId()}`
    const { error: uploadError } = await client.storage
      .from(testBucket)
      .upload(from, new Blob([content], { type: 'text/plain' }))
    expect(uploadError).toBeNull()

    const { data, error: copyError } = await client.storage.from(testBucket).copy(from, to)
    expect(copyError).toBeNull()
    expect(data?.path).toBe(to)

    const { data: blob, error: downloadError } = await client.storage.from(testBucket).download(to)
    expect(downloadError).toBeNull()
    expect(blob).not.toBeNull()
    expect(await (blob as Blob).text()).toBe(content)
  })
})

describe('storage-local: move', () => {
  it('moves an object and removes the source', async () => {
    const from = `move-src-${uniqueId()}.txt`
    const to = `move-dst-${uniqueId()}.txt`
    const content = `move me - ${uniqueId()}`
    const { error: uploadError } = await client.storage
      .from(testBucket)
      .upload(from, new Blob([content], { type: 'text/plain' }))
    expect(uploadError).toBeNull()

    const { data, error: moveError } = await client.storage.from(testBucket).move(from, to)
    expect(moveError).toBeNull()
    expect(data?.path).toBe(to)

    const { data: sourceExists } = await client.storage.from(testBucket).exists(from)
    expect(sourceExists).toBe(false)

    const { data: blob, error: downloadError } = await client.storage.from(testBucket).download(to)
    expect(downloadError).toBeNull()
    expect(await (blob as Blob).text()).toBe(content)
  })
})

describe('storage-local: exists', () => {
  it('reports true for an uploaded object and false for a missing one', async () => {
    const path = `exists-${uniqueId()}.txt`
    const { error: uploadError } = await client.storage
      .from(testBucket)
      .upload(path, new Blob(['exists me'], { type: 'text/plain' }))
    expect(uploadError).toBeNull()

    const { data: present, error: presentError } = await client.storage
      .from(testBucket)
      .exists(path)
    expect(presentError).toBeNull()
    expect(present).toBe(true)

    const { data: absent, error: absentError } = await client.storage
      .from(testBucket)
      .exists(`missing-${uniqueId()}.txt`)
    expect(absentError).toBeNull()
    expect(absent).toBe(false)
  })
})

describe('storage-local: bucket name validation', () => {
  it('SDK createBucket rejects a traversal bucket name with INVALID_BUCKET', async () => {
    const { data, error } = await client.storage.createBucket('../esc', { public: true })
    expect(data).toBeNull()
    expect(error?.code).toBe('INVALID_BUCKET')
  })

  it('server rejects a traversal bucket name in the create bucket body', async () => {
    const res = await fetch(`${origin}/storage/v1/bucket`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '../esc', public: false }),
    })
    expect(res.status).toBe(400)
  })

  it('server rejects a traversal bucket segment in the object list URL', async () => {
    // fetch() normalizes `..` out of the URL before the request is sent, so
    // the literal form below can never reach the route params — it must be a
    // client error (no filesystem escape), never 2xx. Use the URL-encoded
    // form to pin the server's 400 validation contract.
    const literalRes = await fetch(`${origin}/storage/v1/object/list/../etc`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(literalRes.status).toBeGreaterThanOrEqual(400)
    expect(literalRes.status).toBeLessThan(500)

    const encodedRes = await fetch(`${origin}/storage/v1/object/list/%2e%2e%2fetc`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(encodedRes.status).toBe(400)
  })
})
