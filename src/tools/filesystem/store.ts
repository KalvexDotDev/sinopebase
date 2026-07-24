/**
 * Local Filesystem Storage Store
 *
 * Provides file read/write/delete/list operations against a local directory.
 * Used as fallback when MinIO is not configured.
 */
import * as fs from 'fs/promises'
import { existsSync } from 'fs'
import { join, dirname, resolve as resolvePath, sep } from 'path'
import type { IFileStore } from './store-interface'

export interface LocalFileInfo {
  name: string
  id: string | null
  updated_at: string | null
  created_at: string | null
  last_accessed_at: string | null
  metadata: Record<string, unknown> | null
}

export interface LocalBucketInfo {
  id: string
  name: string
  owner: string
  public: boolean
  created_at: string
  updated_at: string
}

export class LocalFileStore implements IFileStore {
  private basePath: string

  constructor(basePath: string) {
    this.basePath = basePath
  }

  private storagePath(): string {
    return join(this.basePath, 'storage')
  }

  private bucketPath(bucket: string): string {
    return join(this.storagePath(), bucket)
  }

  private resolveObjectPath(bucket: string, path: string): string {
    const baseDir = resolvePath(this.bucketPath(bucket))
    const fullPath = resolvePath(join(baseDir, path))
    // Prevent path traversal attacks
    if (!fullPath.startsWith(baseDir + sep)) {
      throw new Error('Invalid path: traversal detected')
    }
    return fullPath
  }

  /**
   * Ensure a bucket directory exists, creating it if necessary.
   */
  async ensureBucket(bucket: string): Promise<void> {
    const bp = this.bucketPath(bucket)
    if (!existsSync(bp)) {
      await fs.mkdir(bp, { recursive: true })
    }
  }

  /**
   * Save a file to the store.
   */
  async save(bucket: string, path: string, data: ArrayBuffer): Promise<void> {
    await this.ensureBucket(bucket)
    const fp = this.resolveObjectPath(bucket, path)
    await fs.mkdir(dirname(fp), { recursive: true })
    await fs.writeFile(fp, Buffer.from(data))
  }

  /**
   * Read a file from the store.
   */
  async read(bucket: string, path: string): Promise<Buffer> {
    return fs.readFile(this.resolveObjectPath(bucket, path))
  }

  /**
   * Delete files from the store.
   * Returns the list of paths that were successfully deleted.
   */
  async delete(bucket: string, paths: string[]): Promise<string[]> {
    const deleted: string[] = []
    for (const p of paths) {
      try {
        await fs.unlink(this.resolveObjectPath(bucket, p))
        deleted.push(p)
      } catch {
        // File not found or already deleted — skip
      }
    }
    return deleted
  }

  /**
   * List files in a bucket with an optional prefix filter.
   */
  async list(bucket: string, prefix?: string): Promise<LocalFileInfo[]> {
    const bp = this.bucketPath(bucket)
    if (!existsSync(bp)) {
      return []
    }

    const files: LocalFileInfo[] = []
    const entries = await fs.readdir(bp, { withFileTypes: true })

    for (const entry of entries) {
      // Skip internal metadata files and directories
      if (!entry.isFile() || entry.name === '.bucket.json') {
        continue
      }
      if (prefix && !entry.name.startsWith(prefix)) {
        continue
      }
      const fp = join(bp, entry.name)
      try {
        const stats = await fs.stat(fp)
        files.push({
          name: entry.name,
          id: null,
          updated_at: stats.mtime.toISOString(),
          created_at: stats.birthtime.toISOString(),
          last_accessed_at: stats.atime.toISOString(),
          metadata: { size: stats.size },
        })
      } catch {
        // Skip files we cannot stat
      }
    }

    return files
  }

  /**
   * List all buckets in the store.
   */
  async listBuckets(): Promise<LocalBucketInfo[]> {
    const sp = this.storagePath()
    if (!existsSync(sp)) {
      return []
    }

    const buckets: LocalBucketInfo[] = []
    const entries = await fs.readdir(sp, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const now = new Date().toISOString()
        buckets.push({
          id: entry.name,
          name: entry.name,
          owner: '',
          public: false,
          created_at: now,
          updated_at: now,
        })
      }
    }

    return buckets
  }

  /**
   * Create a bucket (idempotent — succeeds if already exists).
   */
  async createBucket(name: string): Promise<string> {
    await this.ensureBucket(name)
    return name
  }
}
