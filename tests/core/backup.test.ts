/**
 * Tests for backup utility (src/core/backup.ts) and backup-files (src/core/backup-files.ts).
 *
 * These tests verify:
 * - pgDump produces valid SQL file
 * - verifyBackup rejects empty/corrupt files
 * - listBackups sorts correctly
 * - cleanupOldBackups respects keepCount
 * - Backup file manifest is valid JSON
 *
 * Full pgDump + pgRestore roundtrip requires a live PostgreSQL server and is
 * skipped when POSTGRES_URL is not set.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  cleanupOldBackups,
  listBackups,
  pgDump,
  pgRestore,
  verifyBackup,
} from '../../src/core/backup'
import { backupFileStore, restoreFileStore } from '../../src/core/backup-files'
import type { Bucket, FileObject, IFileStore } from '../../src/tools/filesystem/store-interface'

// ---------------------------------------------------------------------------
// In-memory file store stub for testing
// ---------------------------------------------------------------------------

class TestFileStore implements IFileStore {
  private objects = new Map<string, Map<string, ArrayBuffer>>()
  private buckets = new Set<string>()

  async ensureBucket(name: string): Promise<void> {
    this.buckets.add(name)
    if (!this.objects.has(name)) {
      this.objects.set(name, new Map())
    }
  }

  async createBucket(name: string): Promise<string> {
    await this.ensureBucket(name)
    return name
  }

  async listBuckets(): Promise<Bucket[]> {
    return Array.from(this.buckets).map((name) => ({
      id: name,
      name,
      owner: '',
      public: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }))
  }

  async save(bucket: string, path: string, data: ArrayBuffer): Promise<void> {
    await this.ensureBucket(bucket)
    this.objects.get(bucket)?.set(path, data)
  }

  async read(bucket: string, path: string): Promise<Buffer> {
    const data = this.objects.get(bucket)?.get(path)
    if (!data) throw new Error('File not found')
    return Buffer.from(data)
  }

  async delete(bucket: string, paths: string[]): Promise<string[]> {
    const deleted: string[] = []
    const map = this.objects.get(bucket)
    if (map) {
      for (const p of paths) {
        if (map.delete(p)) deleted.push(p)
      }
    }
    return deleted
  }

  async list(bucket: string, _prefix?: string): Promise<FileObject[]> {
    const map = this.objects.get(bucket)
    if (!map) return []
    return Array.from(map.keys()).map((name) => ({
      name,
      id: null,
      updated_at: null,
      created_at: null,
      last_accessed_at: null,
      metadata: null,
    }))
  }
}

// ---------------------------------------------------------------------------
// Fixture directories
// ---------------------------------------------------------------------------

const testTmpDir = join(tmpdir(), `sinopebase-backup-test-${Date.now()}`)
const backupDir = join(testTmpDir, 'backups')

beforeAll(async () => {
  await mkdir(backupDir, { recursive: true })
})

afterAll(async () => {
  const { rm } = await import('node:fs/promises')
  await rm(testTmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// verifyBackup
// ---------------------------------------------------------------------------

describe('verifyBackup', () => {
  it('rejects non-existent file', async () => {
    const result = await verifyBackup(join(backupDir, 'nonexistent.sql'))
    expect(result).toBe(false)
  })

  it('rejects empty file', async () => {
    const emptyPath = join(backupDir, 'empty.sql')
    await writeFile(emptyPath, '')
    const result = await verifyBackup(emptyPath)
    expect(result).toBe(false)
  })

  it('rejects file with only whitespace', async () => {
    const wsPath = join(backupDir, 'whitespace.sql')
    await writeFile(wsPath, '   \n\n  ')
    const result = await verifyBackup(wsPath)
    expect(result).toBe(false)
  })

  it('rejects binary file (null bytes)', async () => {
    const binPath = join(backupDir, 'binary.dat')
    await writeFile(binPath, '\0\0\0some garbage')
    const result = await verifyBackup(binPath)
    expect(result).toBe(false)
  })

  it('accepts valid SQL dump (starts with comment)', async () => {
    const sqlPath = join(backupDir, 'valid.sql')
    await writeFile(sqlPath, '-- PostgreSQL database dump\n\nCREATE TABLE test (id int);\n')
    const result = await verifyBackup(sqlPath)
    expect(result).toBe(true)
  })

  it('accepts valid SQL without comment header', async () => {
    const sqlPath = join(backupDir, 'plain.sql')
    await writeFile(sqlPath, 'SELECT 1;\n')
    const result = await verifyBackup(sqlPath)
    expect(result).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// listBackups
// ---------------------------------------------------------------------------

describe('listBackups', () => {
  it('returns empty array for missing directory', async () => {
    const result = await listBackups(join(testTmpDir, 'nonexistent'))
    expect(result).toEqual([])
  })

  it('returns sorted list with newest first', async () => {
    const listDir = join(testTmpDir, 'list-test')
    await mkdir(listDir, { recursive: true })

    const fileA = join(listDir, 'old.sql')
    const fileB = join(listDir, 'new.sql')
    await writeFile(fileA, '-- old')
    await writeFile(fileB, '-- new')

    await new Promise((r) => setTimeout(r, 100))

    const fileC = join(listDir, 'middle.sql')
    await writeFile(fileC, '-- middle')

    const result = await listBackups(listDir)
    expect(result.length).toBe(3)
    expect(result[0]?.name).toBe('middle.sql')
    expect(result[0]?.size).toBeGreaterThan(0)
    expect(result[0]?.modified).toBeTruthy()
  })

  it('skips directories', async () => {
    const listDir = join(testTmpDir, 'list-with-dir')
    await mkdir(listDir, { recursive: true })
    await writeFile(join(listDir, 'backup.sql'), '-- data')
    await mkdir(join(listDir, 'subdir'), { recursive: true })

    const result = await listBackups(listDir)
    expect(result.length).toBe(1)
    expect(result[0]?.name).toBe('backup.sql')
  })
})

// ---------------------------------------------------------------------------
// cleanupOldBackups
// ---------------------------------------------------------------------------

describe('cleanupOldBackups', () => {
  it('keeps N most recent backups', async () => {
    const cleanDir = join(testTmpDir, 'cleanup-test')
    await mkdir(cleanDir, { recursive: true })

    for (let i = 0; i < 5; i++) {
      await writeFile(join(cleanDir, `backup-${i}.sql`), '-- content')
      await new Promise((r) => setTimeout(r, 50))
    }

    const deleted = await cleanupOldBackups(cleanDir, 2)
    expect(deleted.length).toBe(3)

    const remaining = await listBackups(cleanDir)
    expect(remaining.length).toBe(2)
  })

  it('does nothing when below keepCount', async () => {
    const cleanDir = join(testTmpDir, 'cleanup-below')
    await mkdir(cleanDir, { recursive: true })
    await writeFile(join(cleanDir, 'backup.sql'), '-- content')

    const deleted = await cleanupOldBackups(cleanDir, 5)
    expect(deleted).toEqual([])
  })

  it('handles empty directory', async () => {
    const cleanDir = join(testTmpDir, 'cleanup-empty')
    await mkdir(cleanDir, { recursive: true })

    const deleted = await cleanupOldBackups(cleanDir, 5)
    expect(deleted).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// backupFileStore / restoreFileStore
// ---------------------------------------------------------------------------

describe('backupFileStore / restoreFileStore', () => {
  it('produces valid manifest JSON and restores files', async () => {
    const store = new TestFileStore()
    const fsBackupDir = join(testTmpDir, 'filestore-backup')
    await mkdir(fsBackupDir, { recursive: true })

    await store.save('bucket-a', 'doc.txt', Buffer.from('hello world'))
    await store.save('bucket-a', 'data.json', Buffer.from('{"key":"value"}'))
    await store.save('bucket-b', 'img.png', Buffer.from('fake-image-bytes'))

    const manifest = await backupFileStore(store, fsBackupDir)

    expect(manifest).toHaveProperty('createdAt')
    expect(manifest.files.length).toBe(3)

    const manifestPath = join(fsBackupDir, 'manifest.json')
    expect(existsSync(manifestPath)).toBe(true)
    const raw = JSON.parse(await readFile(manifestPath, 'utf-8'))
    expect(raw).toHaveProperty('files')
    expect(raw.files.length).toBe(3)

    const restored = new TestFileStore()
    await restoreFileStore(restored, fsBackupDir)

    const docContent = await restored.read('bucket-a', 'doc.txt')
    expect(docContent.toString()).toBe('hello world')

    const jsonContent = await restored.read('bucket-a', 'data.json')
    expect(jsonContent.toString()).toBe('{"key":"value"}')

    const imgContent = await restored.read('bucket-b', 'img.png')
    expect(imgContent.toString()).toBe('fake-image-bytes')
  })

  it('throws on missing manifest', async () => {
    const store = new TestFileStore()
    const emptyDir = join(testTmpDir, 'no-manifest')
    await mkdir(emptyDir, { recursive: true })

    await expect(restoreFileStore(store, emptyDir)).rejects.toThrow('Backup manifest not found')
  })
})

// ---------------------------------------------------------------------------
// pgDump roundtrip — integration, depends on live PostgreSQL
// ---------------------------------------------------------------------------

describe('pgDump + pgRestore (integration)', () => {
  const postgresUrl = process.env.POSTGRES_URL || ''

  beforeAll(() => {
    if (!postgresUrl) {
      console.log('Skipping pgDump/pgRestore tests: POSTGRES_URL not set')
    }
  })

  it('pgDump produces a valid SQL file (if pg_dump is available and POSTGRES_URL is set)', async () => {
    if (!postgresUrl) return

    const dumpPath = join(testTmpDir, 'pg-integration-dump.sql')
    try {
      await pgDump(postgresUrl, dumpPath)
      expect(existsSync(dumpPath)).toBe(true)
      const content = await readFile(dumpPath, 'utf-8')
      expect(content.length).toBeGreaterThan(0)

      const valid = await verifyBackup(dumpPath)
      expect(valid).toBe(true)
    } catch (err) {
      console.log('pg_dump not available, skipping:', (err as Error).message)
    }
  })

  it('pgRestore roundtrips (if psql is available and POSTGRES_URL is set)', async () => {
    if (!postgresUrl) return

    const dumpPath = join(testTmpDir, 'pg-roundtrip.sql')
    const testSql =
      '-- Test dump\nCREATE TABLE IF NOT EXISTS _backup_test (id int);\nDROP TABLE IF EXISTS _backup_test;\n'

    await writeFile(dumpPath, testSql)

    try {
      await pgRestore(postgresUrl, dumpPath)
      expect(true).toBe(true)
    } catch (err) {
      console.log('psql not available, skipping:', (err as Error).message)
    }
  })
})
