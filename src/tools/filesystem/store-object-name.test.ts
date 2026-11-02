/**
 * Physical stores refuse object names that resolve outside their own prefix
 * while staying inside the bucket (sinope#1111).
 * @new-code-test positive src/tools/filesystem/store.ts
 * @new-code-test negative src/tools/filesystem/store.ts
 * @new-code-test positive src/tools/filesystem/store-s3.ts
 * @new-code-test negative src/tools/filesystem/store-s3.ts
 */
import { describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalFileStore } from './store'
import { S3FileStore } from './store-s3'

const CROSSING_NAMES = ['tenant-a/../tenant-b/b.txt', 'tenant-a//b.txt', '/tenant-b/b.txt']
const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer

describe('LocalFileStore object names', () => {
  it('keeps another prefix intact when a name crosses into it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sinopebase-object-name-'))
    try {
      const store = new LocalFileStore(root)
      await store.save('evidence', 'tenant-b/b.txt', bytes('tenant b'))
      for (const name of CROSSING_NAMES) {
        await expect(store.save('evidence', name, bytes('overwrite'))).rejects.toThrow(
          'Invalid object name',
        )
        await expect(store.read('evidence', name)).rejects.toThrow('Invalid object name')
        expect(await store.delete('evidence', [name])).toEqual([])
      }
      const target = join(root, 'storage', 'evidence', 'tenant-b', 'b.txt')
      expect(await readFile(target, 'utf8')).toBe('tenant b')
      expect(await store.read('evidence', 'tenant-b/b.txt')).toEqual(Buffer.from('tenant b'))
      expect(await store.delete('evidence', ['tenant-b/b.txt'])).toEqual(['tenant-b/b.txt'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('S3FileStore object names', () => {
  function s3Store(calls: string[]) {
    const store = new S3FileStore({ endpoint: '127.0.0.1', accessKey: 'test', secretKey: 'test' })
    ;(store as unknown as { client: Record<string, unknown> }).client = {
      bucketExists: async () => true,
      putObject: async (_bucket: string, key: string) => calls.push(`put ${key}`),
      getObject: async (_bucket: string, key: string) => {
        calls.push(`get ${key}`)
        return [Buffer.from('tenant b')]
      },
      removeObjects: async (_bucket: string, keys: string[]) => calls.push(`remove ${keys}`),
      presignedGetObject: async (_bucket: string, key: string) => `signed ${key}`,
    }
    return store
  }

  it('never sends a crossing key to the object store', async () => {
    const calls: string[] = []
    const store = s3Store(calls)
    for (const name of CROSSING_NAMES) {
      await expect(store.save('evidence', name, bytes('overwrite'))).rejects.toThrow(
        'Invalid object name',
      )
      await expect(store.read('evidence', name)).rejects.toThrow('Invalid object name')
      await expect(store.delete('evidence', ['tenant-b/c.txt', name])).rejects.toThrow(
        'Invalid object name',
      )
      await expect(store.presignedGetUrl('evidence', name)).rejects.toThrow('Invalid object name')
    }
    expect(calls).toEqual([])
  })

  it('passes valid keys through unchanged', async () => {
    const calls: string[] = []
    const store = s3Store(calls)
    await store.save('evidence', 'tenant-b/b.txt', bytes('tenant b'))
    expect(await store.read('evidence', 'tenant-b/b.txt')).toEqual(Buffer.from('tenant b'))
    expect(await store.delete('evidence', ['tenant-b/b.txt'])).toEqual(['tenant-b/b.txt'])
    expect(await store.presignedGetUrl('evidence', 'tenant-b/b.txt')).toBe('signed tenant-b/b.txt')
    expect(calls).toEqual(['put tenant-b/b.txt', 'get tenant-b/b.txt', 'remove tenant-b/b.txt'])
  })
})
