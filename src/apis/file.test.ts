import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { createStoragePlugin } from './file'
import type { Bucket, FileObject, IFileStore } from '../tools/filesystem/store-interface'
import type { PostgresRequestContext } from '../core/db-postgres'
import {
  StorageAccessError,
  type StorageAccessPolicy,
  type StorageBucketInput,
  type StorageUploadInput,
  validateBucketConstraints,
} from './storage-access'

class TestFileStore implements IFileStore {
  readonly files = new Map<string, Buffer>()

  async save(bucket: string, path: string, data: ArrayBuffer): Promise<void> {
    this.files.set(`${bucket}/${path}`, Buffer.from(data))
  }
  async read(bucket: string, path: string): Promise<Buffer> {
    const file = this.files.get(`${bucket}/${path}`)
    if (!file) throw new Error('not found')
    return file
  }
  async delete(bucket: string, paths: string[]): Promise<string[]> {
    return paths.filter((path) => this.files.delete(`${bucket}/${path}`))
  }
  async list(bucket: string, prefix = ''): Promise<FileObject[]> {
    return [...this.files.keys()]
      .filter((key) => key.startsWith(`${bucket}/${prefix}`))
      .map((key) => ({
        name: key.slice(bucket.length + 1), id: key, updated_at: null,
        created_at: null, last_accessed_at: null, metadata: null,
      }))
  }
  async listBuckets(): Promise<Bucket[]> { return [] }
  async createBucket(name: string): Promise<string> { return name }
  async ensureBucket(_name: string): Promise<void> {}
}

function storageApp(
  store = new TestFileStore(),
  access?: StorageAccessPolicy,
  resolveContext: (request: Request) => PostgresRequestContext | undefined = () => ({ role: 'service_role' }),
) {
  return { app: new Elysia().use(createStoragePlugin(store, { access, resolveContext })), store }
}

class TestStorageAccess implements StorageAccessPolicy {
  owners = new Map<string, string>()
  lastUpload?: StorageUploadInput
  async isAvailable() { return true }
  async listBuckets() { return [] }
  async createBucket(_context: PostgresRequestContext, _input: StorageBucketInput, persist: () => Promise<unknown>) { await persist() }
  async listObjects() { return [] }
  async upload(context: PostgresRequestContext, input: StorageUploadInput, persist: () => Promise<unknown>) {
    this.lastUpload = input
    await persist()
    this.owners.set(`${input.bucket}/${input.path}`, context.userId ?? '')
  }
  async download(context: PostgresRequestContext, bucket: string, path: string, read: () => Promise<Buffer>) {
    if (this.owners.get(`${bucket}/${path}`) !== context.userId) {
      throw new StorageAccessError(404, '404', 'Object not found')
    }
    return read()
  }
  async remove(context: PostgresRequestContext, bucket: string, paths: string[], persist: (paths: string[]) => Promise<string[]>) {
    const allowed = paths.filter((path) => this.owners.get(`${bucket}/${path}`) === context.userId)
    return persist(allowed)
  }
  async authorizeSignedUrl() {}
  async downloadPublic(_bucket: string, _path: string, read: () => Promise<Buffer>) { return read() }
}

describe('Supabase Storage HTTP compatibility', () => {
  it('accepts the raw binary body sent by storage-js for Buffer uploads', async () => {
    const { app, store } = storageApp()
    const response = await app.handle(new Request(
      'http://localhost/storage/v1/object/evidence/tenant/control/policy.pdf',
      { method: 'POST', headers: { 'content-type': 'application/pdf' }, body: 'policy' },
    ))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      Id: 'evidence/tenant/control/policy.pdf',
      Key: 'evidence/tenant/control/policy.pdf',
    })
    expect(store.files.get('evidence/tenant/control/policy.pdf')?.toString()).toBe('policy')
  })

  it('accepts the unnamed multipart field sent by storage-js for File uploads', async () => {
    const { app, store } = storageApp()
    const form = new FormData()
    form.append('cacheControl', '3600')
    form.append('', new Blob(['logo'], { type: 'image/png' }))

    const response = await app.handle(new Request(
      'http://localhost/storage/v1/object/company-logos/tenant/profile/logo.png',
      { method: 'POST', body: form },
    ))

    expect(response.status).toBe(200)
    expect(store.files.get('company-logos/tenant/profile/logo.png')?.toString()).toBe('logo')
  })

  it('returns raw list data and accepts storage-js prefixes for remove', async () => {
    const { app, store } = storageApp()
    store.files.set('evidence/tenant/a.pdf', Buffer.from('a'))

    const list = await app.handle(new Request(
      'http://localhost/storage/v1/object/list/evidence',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prefix: 'tenant/' }) },
    ))
    expect(await list.json()).toEqual([expect.objectContaining({ name: 'tenant/a.pdf' })])

    const remove = await app.handle(new Request(
      'http://localhost/storage/v1/object/evidence',
      { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: ['tenant/a.pdf'] }) },
    ))
    expect(remove.status).toBe(200)
    expect(await remove.json()).toEqual([{ name: 'tenant/a.pdf', bucket_id: 'evidence' }])
    expect(store.files.has('evidence/tenant/a.pdf')).toBe(false)
  })

  it('downloads stored bytes without a JSON response wrapper', async () => {
    const { app, store } = storageApp()
    store.files.set('evidence/tenant/a.pdf', Buffer.from('download me'))

    const response = await app.handle(new Request(
      'http://localhost/storage/v1/object/evidence/tenant/a.pdf',
    ))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('download me')
  })

  it('fails closed for authenticated storage when metadata policy support is unavailable', async () => {
    const store = new TestFileStore()
    const { app } = storageApp(store, undefined, () => ({ role: 'authenticated', userId: 'member-a' }))
    const response = await app.handle(new Request(
      'http://localhost/storage/v1/object/evidence/tenant/a.pdf',
      { method: 'POST', headers: { 'content-type': 'application/pdf' }, body: 'private' },
    ))

    expect(response.status).toBe(503)
    expect(store.files.size).toBe(0)
  })

  it('passes verified identity and upload metadata to policy enforcement', async () => {
    const access = new TestStorageAccess()
    const { app, store } = storageApp(
      new TestFileStore(),
      access,
      () => ({ role: 'authenticated', userId: 'member-a' }),
    )
    const response = await app.handle(new Request(
      'http://localhost/storage/v1/object/evidence/tenant/a.pdf',
      { method: 'POST', headers: { 'content-type': 'application/pdf' }, body: 'private' },
    ))

    expect(response.status).toBe(200)
    expect(access.lastUpload).toMatchObject({
      bucket: 'evidence', path: 'tenant/a.pdf', contentType: 'application/pdf', upsert: false,
    })
    expect(access.lastUpload?.data.byteLength).toBe(7)
    expect(store.files.has('evidence/tenant/a.pdf')).toBe(true)
  })

  it('does not expose one member object to another member', async () => {
    const access = new TestStorageAccess()
    const store = new TestFileStore()
    access.owners.set('evidence/tenant/a.pdf', 'member-a')
    store.files.set('evidence/tenant/a.pdf', Buffer.from('private'))
    const { app } = storageApp(store, access, (request) => ({
      role: 'authenticated',
      userId: request.headers.get('x-test-user') ?? '',
    }))
    const response = await app.handle(new Request(
      'http://localhost/storage/v1/object/evidence/tenant/a.pdf',
      { headers: { 'x-test-user': 'member-b' } },
    ))

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ message: 'Object not found' })
  })

  it('rejects objects exceeding bucket size or outside its MIME allow-list', () => {
    const bucket = { fileSizeLimit: 4, allowedMimeTypes: ['application/pdf', 'image/*'] }
    expect(() => validateBucketConstraints(bucket, {
      data: new Uint8Array(5).buffer,
      contentType: 'application/pdf',
    })).toThrow('file size limit')
    expect(() => validateBucketConstraints(bucket, {
      data: new Uint8Array(4).buffer,
      contentType: 'text/plain',
    })).toThrow('MIME type text/plain is not allowed')
    expect(() => validateBucketConstraints(bucket, {
      data: new Uint8Array(4).buffer,
      contentType: 'image/png',
    })).not.toThrow()
  })
})
