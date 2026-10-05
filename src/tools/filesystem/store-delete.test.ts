/**
 * @new-code-test positive src/tools/filesystem/store.ts
 * @new-code-test negative src/tools/filesystem/store.ts
 * @new-code-test positive src/tools/filesystem/store-s3.ts
 * @new-code-test negative src/tools/filesystem/store-s3.ts
 */
import { describe, expect, it } from 'bun:test'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalFileStore } from './store'
import { S3FileStore } from './store-s3'

describe('bucket deletion in physical file stores', () => {
  it('removes an empty local bucket and its metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sinopebase-bucket-delete-'))
    try {
      const store = new LocalFileStore(root)
      await store.createBucket('empty')
      await writeFile(join(root, 'storage', 'empty', '.bucket.json'), '{}')
      await store.deleteBucket('empty')
      expect(await readdir(join(root, 'storage'))).not.toContain('empty')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps a local bucket containing a file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sinopebase-bucket-delete-'))
    try {
      const store = new LocalFileStore(root)
      await store.createBucket('occupied')
      await writeFile(join(root, 'storage', 'occupied', '.bucket.json'), '{}')
      await store.save('occupied', 'keep.txt', new TextEncoder().encode('keep').buffer)
      await expect(store.deleteBucket('occupied')).rejects.toThrow('Bucket is not empty')
      expect(await store.read('occupied', 'keep.txt')).toEqual(Buffer.from('keep'))
      expect(await readdir(join(root, 'storage', 'occupied'))).toContain('.bucket.json')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('removes an empty local bucket without a metadata file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sinopebase-bucket-delete-'))
    try {
      const store = new LocalFileStore(root)
      await store.createBucket('bare')
      await store.deleteBucket('bare')
      expect(await readdir(join(root, 'storage'))).not.toContain('bare')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('delegates S3 deletion to the remote bucket API', async () => {
    const calls: string[] = []
    const store = new S3FileStore({
      endpoint: '127.0.0.1',
      accessKey: 'test',
      secretKey: 'test',
    })
    ;(store as unknown as { client: { removeBucket: (name: string) => Promise<void> } }).client = {
      removeBucket: async (name) => {
        calls.push(name)
      },
    }
    await store.deleteBucket('empty')
    expect(calls).toEqual(['empty'])
  })

  it('surfaces S3 nonempty-bucket failures without deleting metadata', async () => {
    const store = new S3FileStore({
      endpoint: '127.0.0.1',
      accessKey: 'test',
      secretKey: 'test',
    })
    ;(store as unknown as { client: { removeBucket: (name: string) => Promise<void> } }).client = {
      removeBucket: async () => {
        throw new Error('BucketNotEmpty')
      },
    }
    await expect(store.deleteBucket('occupied')).rejects.toThrow('BucketNotEmpty')
  })
})
