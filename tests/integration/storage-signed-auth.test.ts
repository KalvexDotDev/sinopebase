// @new-code-test positive src/core/app.ts
// @new-code-test negative src/core/app.ts
import { afterAll, beforeAll, describe, expect, it, spyOn } from 'bun:test'
import { Client } from 'minio'
import { Pool } from 'pg'
import { signUrl } from '~/apis/signed-url'
import { Sinopebase } from '~/core/app'
import { logger } from '~/core/logger'
import { createClient, type SinopebaseClient } from '~/sdk/client'
import { S3FileStore } from '~/tools/filesystem/store-s3'
import {
  createTestNamespace,
  requirePostgres,
  requireRustFS,
  reserveLoopbackPort,
} from '../harness'

const serviceKey = 'signed-storage-service-key-minimum-32-chars'
const anonKey = 'signed-storage-anonymous-key-minimum-32-chars'
const bucket = createTestNamespace({ suiteId: 'signed-auth' }).storageBucket('private')
const path = 'private.txt'
const content = 'Private signed storage regression fixture'
let server: Sinopebase
let admin: SinopebaseClient
let origin: string
let signedUrl: string

beforeAll(async () => {
  const port = await reserveLoopbackPort()
  const storage = requireRustFS()
  server = new Sinopebase({
    postgresUrl: requirePostgres(),
    minioEndpoint: storage.endpoint,
    minioAccessKey: storage.accessKey,
    minioSecretKey: storage.secretKey,
    port: port.port,
    jwtSecret: 'signed-storage-jwt-secret-minimum-32-chars',
    serviceRoleKey: serviceKey,
    anonKey,
  })
  await port.release()
  await server.start()
  expect(server.getFileStore()).toBeInstanceOf(S3FileStore)
  origin = port.origin
  admin = createClient(origin, serviceKey)
  expect((await admin.storage.createBucket(bucket, { public: false })).error).toBeNull()
  expect(
    (await admin.storage.from(bucket).upload(path, new Blob([content], { type: 'text/plain' })))
      .error,
  ).toBeNull()
  const signed = await admin.storage.from(bucket).createSignedUrl(path, 60)
  expect(signed.error).toBeNull()
  if (!signed.data) throw new Error('Expected a signed URL')
  signedUrl = signed.data.signedUrl
})

afterAll(async () => {
  if (admin) {
    await admin.storage.from(bucket).remove([path])
    const storage = requireRustFS()
    const endpoint = new URL(storage.endpoint)
    const s3 = new Client({
      endPoint: endpoint.hostname,
      port: Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80)),
      useSSL: endpoint.protocol === 'https:',
      accessKey: storage.accessKey,
      secretKey: storage.secretKey,
    })
    await s3.removeBucket(bucket)
    const db = new Pool({ connectionString: requirePostgres() })
    try {
      await db.query('DELETE FROM storage.buckets WHERE id = $1', [bucket])
    } finally {
      await db.end()
    }
  }
  await server?.stop()
})

describe('private storage signed downloads through the complete app', () => {
  it('audits service-role requests but does not label anonymous-key traffic as privileged', async () => {
    const audit = spyOn(logger, 'info')
    const objectPath = `/storage/v1/object/${bucket}/${path}`
    try {
      const privileged = await fetch(`${origin}${objectPath}`, {
        headers: { authorization: `Bearer ${serviceKey}` },
      })
      expect(privileged.status).toBe(200)
      expect(audit).toHaveBeenCalledWith('audit:service_role', { method: 'GET', path: objectPath })
      audit.mockClear()
      await fetch(`${origin}${objectPath}`, { headers: { authorization: `Bearer ${anonKey}` } })
      expect(
        audit.mock.calls.some(
          ([message, context]) => message === 'audit:service_role' && context?.path === objectPath,
        ),
      ).toBe(false)
    } finally {
      audit.mockRestore()
    }
  })

  it('fails closed with a stable error response if authorization auditing throws a non-Error', async () => {
    const objectPath = `/storage/v1/object/${bucket}/${path}`
    const original = logger.info.bind(logger)
    const audit = spyOn(logger, 'info').mockImplementation((message, context) => {
      if (message === 'audit:service_role' && context?.path === objectPath) {
        throw 'synthetic audit failure'
      }
      original(message, context)
    })
    try {
      const response = await fetch(`${origin}/storage/v1/object/${bucket}/${path}`, {
        headers: { authorization: `Bearer ${serviceKey}` },
      })
      expect(response.status).toBe(401)
      expect(await response.json()).toMatchObject({
        message: 'Invalid authorization token',
        code: '401',
      })
    } finally {
      audit.mockRestore()
    }
  })

  it('accepts a valid signed GET without bearer credentials', async () => {
    const response = await fetch(signedUrl)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(content)
  })
})

describe('signed download authorization remains narrowly scoped', () => {
  it('rejects malformed, tampered, expired and upload-only tokens', async () => {
    const original = new URL(signedUrl).pathname.split('/').at(-1)
    if (!original) throw new Error('Expected a signed token')
    const [payload, signature] = original.split('.')
    if (!payload || !signature) throw new Error('Expected token payload and signature')
    const tokens = [
      'invalid-token',
      `${payload}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`,
      signUrl(bucket, path, -1),
      signUrl(bucket, path, 60, 'PUT'),
    ]
    for (const token of tokens) {
      const response = await fetch(`${origin}/storage/v1/object/signed/${token}`)
      expect(response.status).toBe(403)
      expect(await response.text()).not.toContain(content)
    }
  })

  it('requires bearer authorization for minting, uploads, deletes and unsigned reads', async () => {
    const protectedRequests = [
      { path: `/object/sign/${bucket}/${path}`, method: 'POST', body: { expiresIn: 60 } },
      { path: `/object/${bucket}/unwanted.txt`, method: 'POST', body: {} },
      { path: `/object/${bucket}`, method: 'DELETE', body: { paths: [path] } },
      { path: `/object/${bucket}/${path}`, method: 'GET' },
      { path: '/object/signed/upload/dummy', method: 'PUT', body: {} },
      { path: '/object/signed/dummy', method: 'POST', body: {} },
      { path: '/object/signed/dummy/extra', method: 'GET' },
    ]
    for (const request of protectedRequests) {
      const response = await fetch(`${origin}/storage/v1${request.path}`, {
        method: request.method,
        headers: { 'content-type': 'application/json' },
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
      })
      expect(response.status).toBe(401)
      expect(await response.json()).toMatchObject({
        message: 'Authorization required',
        code: '401',
      })
    }
    const unchanged = await admin.storage.from(bucket).download(path)
    expect(unchanged.error).toBeNull()
    expect(await unchanged.data?.text()).toBe(content)
  })
})
