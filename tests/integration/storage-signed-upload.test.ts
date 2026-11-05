/**
 * Single-use, size-limited signed uploads through the served app (sinope#1103).
 *
 * Sinope hands an External Agent a signed PUT URL into a private quarantine bucket; the URL is
 * the agent's only upload path, so it must work with no key at all, write one new object once,
 * within its byte limit and content type, and never another path. Every case drives the real
 * HTTP server with PostgreSQL storage metadata, as production runs it.
 *
 * @new-code-test positive src/apis/file.ts
 * @new-code-test negative src/apis/file.ts
 * @new-code-test positive src/apis/storage-postgres.ts
 * @new-code-test negative src/apis/storage-postgres.ts
 * @new-code-test positive src/apis/storage-access.ts
 * @new-code-test negative src/apis/storage-access.ts
 * @new-code-test positive src/core/api-authorization.ts
 * @new-code-test negative src/core/api-authorization.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pool } from 'pg'
import { Sinopebase } from '~/core/app'
import { createClient, type SinopebaseClient } from '~/sdk/client'
import { LocalFileStore } from '~/tools/filesystem/store'
import { createTestNamespace, requirePostgres, reserveLoopbackPort } from '../harness'

const serviceKey = 'signed-upload-service-key-minimum-32-chars'
const anonKey = 'signed-upload-anonymous-key-minimum-32-chars'
const bucket = createTestNamespace({ suiteId: 'signed-upload' }).storageBucket('intake')
const LIMIT = 64
const savedRustfsEnv: Record<string, string | undefined> = {}
let server: Sinopebase
let admin: SinopebaseClient
let origin: string
let dataDir: string
let db: Pool

beforeAll(async () => {
  // The local store keeps this suite independent of object storage; PostgreSQL holds the
  // storage metadata and the consumed-token record, as in production.
  for (const key of ['RUSTFS_ENDPOINT', 'RUSTFS_ACCESS_KEY', 'RUSTFS_SECRET_KEY']) {
    savedRustfsEnv[key] = process.env[key]
    delete process.env[key]
  }
  const postgresUrl = requirePostgres()
  dataDir = await mkdtemp(join(tmpdir(), 'sinope-signed-upload-'))
  const port = await reserveLoopbackPort()
  server = new Sinopebase({
    postgresUrl,
    dataDir,
    port: port.port,
    jwtSecret: 'signed-upload-jwt-secret-minimum-32-chars',
    serviceRoleKey: serviceKey,
    anonKey,
  })
  await port.release()
  await server.start()
  expect(server.getFileStore()).toBeInstanceOf(LocalFileStore)
  origin = port.origin
  admin = createClient(origin, serviceKey)
  db = new Pool({ connectionString: postgresUrl })
  // As Sinope's migrations provision its private buckets, with their own limits.
  await db.query(
    `INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
     VALUES ($1, $1, false, 1024, ARRAY['application/pdf', 'text/plain'])`,
    [bucket],
  )
})

afterAll(async () => {
  if (db) {
    await db.query('DELETE FROM storage.objects WHERE bucket_id = $1', [bucket])
    await db.query('DELETE FROM storage.consumed_upload_tokens WHERE bucket_id = $1', [bucket])
    await db.query('DELETE FROM storage.buckets WHERE id = $1', [bucket])
    await db.end()
  }
  await server?.stop()
  if (dataDir) await rm(dataDir, { recursive: true, force: true })
  for (const [key, value] of Object.entries(savedRustfsEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

/** Mint an upload URL as Sinope's server does: service role, its own limits. */
async function sign(path: string, limits: Record<string, unknown> = {}): Promise<Response> {
  return fetch(`${origin}/storage/v1/object/sign/${bucket}/${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      method: 'PUT',
      expiresIn: 60,
      maxBytes: LIMIT,
      contentType: 'application/pdf',
      ...limits,
    }),
  })
}

async function uploadUrl(path: string, limits: Record<string, unknown> = {}): Promise<string> {
  const response = await sign(path, limits)
  expect(response.status).toBe(200)
  const { signedURL } = (await response.json()) as { signedURL: string }
  expect(signedURL).toStartWith('/storage/v1/object/signed/upload/')
  return `${origin}${signedURL}`
}

/** PUT as an External Agent does: no key, only the URL. */
function put(url: string, body: BodyInit, headers: Record<string, string> = {}) {
  return fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/pdf', ...headers },
    body,
    duplex: 'half',
  } as RequestInit)
}

async function stored(path: string): Promise<string | null> {
  const { data } = await admin.storage.from(bucket).download(path)
  return data ? await data.text() : null
}

describe('signed uploads through the served app', () => {
  it('accepts one keyless PUT and records the object for the bucket', async () => {
    const url = await uploadUrl('tenant-a/request-1/first')
    const response = await put(url, '%PDF-1.7 first')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      Id: `${bucket}/tenant-a/request-1/first`,
      Key: `${bucket}/tenant-a/request-1/first`,
    })
    expect(await stored('tenant-a/request-1/first')).toBe('%PDF-1.7 first')
    const { rows } = await db.query<{ owner_id: string | null; metadata: { size: number } }>(
      'SELECT owner_id, metadata FROM storage.objects WHERE bucket_id = $1 AND name = $2',
      [bucket, 'tenant-a/request-1/first'],
    )
    expect(rows).toEqual([
      {
        owner_id: null,
        metadata: expect.objectContaining({ mimetype: 'application/pdf', size: 14 }),
      },
    ])
  })

  it('refuses reuse, sequential or racing, and keeps the first upload', async () => {
    const url = await uploadUrl('tenant-a/request-1/reuse')
    expect((await put(url, '%PDF-1.7 kept')).status).toBe(200)
    const reused = await put(url, '%PDF-1.7 overwritten')
    expect(reused.status).toBe(403)
    expect(await reused.json()).toMatchObject({ message: 'Token already used' })
    expect(await stored('tenant-a/request-1/reuse')).toBe('%PDF-1.7 kept')

    const raced = await uploadUrl('tenant-a/request-1/race')
    const statuses = await Promise.all(
      Array.from({ length: 5 }, (_, index) => put(raced, `%PDF-1.7 ${index}`)),
    )
    expect(statuses.map((response) => response.status).sort()).toEqual([200, 403, 403, 403, 403])
    const consumed = await db.query(
      'SELECT name FROM storage.consumed_upload_tokens WHERE bucket_id = $1 AND name = $2',
      [bucket, 'tenant-a/request-1/race'],
    )
    expect(consumed.rows).toHaveLength(1)
  })

  it('refuses an expired URL and stores nothing', async () => {
    // Minted already past its expiry, so no clock has to pass.
    const url = await uploadUrl('tenant-a/request-1/late', { expiresIn: -1 })
    const late = await put(url, '%PDF-1.7 late')
    expect(late.status).toBe(403)
    expect(await late.json()).toMatchObject({ message: 'Token expired' })
    expect(await stored('tenant-a/request-1/late')).toBeNull()
  })

  it('writes only its own path: altered tokens and taken names are refused', async () => {
    expect((await put(await uploadUrl('tenant-b/request-9/theirs'), '%PDF-1.7 b')).status).toBe(200)
    const url = await uploadUrl('tenant-a/request-1/mine')
    const token = url.split('/').at(-1) ?? ''
    const [payload, signature] = token.split('.')
    const claims = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf-8'))
    for (const path of ['tenant-b/request-9/theirs', 'tenant-a/request-2/mine']) {
      const altered = Buffer.from(JSON.stringify({ ...claims, path })).toString('base64url')
      const response = await put(
        `${origin}/storage/v1/object/signed/upload/${altered}.${signature}`,
        '%PDF-1.7 x',
      )
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ message: 'Invalid signature' })
    }
    expect(await stored('tenant-b/request-9/theirs')).toBe('%PDF-1.7 b')
    expect(await stored('tenant-a/request-2/mine')).toBeNull()

    // A signed upload never overwrites: no URL is minted for a name already taken.
    const taken = await sign('tenant-b/request-9/theirs')
    expect(taken.status).toBe(409)
    // A read URL is not an upload URL.
    const read = await admin.storage.from(bucket).createSignedUrl('tenant-b/request-9/theirs', 60)
    const readToken = read.data?.signedUrl.split('/').at(-1) ?? ''
    const misused = await put(
      `${origin}/storage/v1/object/signed/upload/${readToken}`,
      '%PDF-1.7 x',
    )
    expect(misused.status).toBe(403)
    expect(await stored('tenant-b/request-9/theirs')).toBe('%PDF-1.7 b')
  })

  it('refuses an oversized body, declared or streamed, and stores nothing', async () => {
    const declared = await uploadUrl('tenant-a/request-1/declared')
    const tooLong = await put(declared, `%PDF-1.7 ${'x'.repeat(LIMIT)}`)
    expect(tooLong.status).toBe(413)
    // A declared length is refused before the URL is spent.
    expect((await put(declared, '%PDF-1.7 fits')).status).toBe(200)

    const streamed = await uploadUrl('tenant-a/request-1/streamed')
    let pulled = 0
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        controller.enqueue(new Uint8Array(16 * 1024).fill(0x41))
      },
    })
    const response = await put(streamed, endless).catch(() => null)
    // The server answers 413 or drops the connection mid-body; either way it stopped reading.
    if (response) expect(response.status).toBe(413)
    expect(pulled).toBeLessThan(1_024)
    expect(await stored('tenant-a/request-1/streamed')).toBeNull()
    expect((await put(streamed, '%PDF-1.7 retry')).status).toBe(403)
  })

  it('accepts only the content type and size the URL and bucket allow', async () => {
    const typed = await uploadUrl('tenant-a/request-1/typed')
    const html = await put(typed, '<script>alert(1)</script>', { 'content-type': 'text/html' })
    expect(html.status).toBe(415)
    expect((await put(typed, '%PDF-1.7 typed')).status).toBe(200)

    // The bucket's own limits still bind a URL minted without a type.
    const untyped = await uploadUrl('tenant-a/request-1/png', { contentType: undefined })
    const png = await put(untyped, '\x89PNG', { 'content-type': 'image/png' })
    expect(png.status).toBe(415)
    expect(await stored('tenant-a/request-1/png')).toBeNull()

    expect((await sign('tenant-a/request-1/huge', { maxBytes: 1024 * 1024 * 1024 })).status).toBe(
      400,
    )
  })

  it('still requires a key to mint an upload URL', async () => {
    const anonymous = await fetch(`${origin}/storage/v1/object/sign/${bucket}/tenant-a/x`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'PUT' }),
    })
    expect(anonymous.status).toBe(401)
    const forged = await put(`${origin}/storage/v1/object/signed/upload/forged.token`, 'x')
    expect(forged.status).toBe(403)
  })
})
