/**
 * PocketBase-style filesystem abstraction.
 *
 * Port of github.com/pocketbase/pocketbase/tree/master/tools/filesystem
 * Layer 1 -- wraps the existing IFileStore implementations (Layer 0).
 *
 * Provides a System interface (Upsert / ReadFile / Delete / ListFiles /
 * CreateSignedUrl / Exists) and two concrete implementations:
 *   - LocalSystem  -- wraps LocalFileStore
 *   - S3System     -- wraps S3FileStore
 *
 * A factory function NewSystem() returns the appropriate implementation
 * based on the provided config.
 */

import { LocalFileStore } from '~/tools/filesystem/store.ts'
import { S3FileStore } from '~/tools/filesystem/store-s3.ts'
import type { IFileStore } from '~/tools/filesystem/store-interface.ts'
import { FileHandle } from '~/tools/filesystem/file.ts'
import type { FileInfo } from '~/tools/filesystem/file.ts'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * SystemConfig specifies the backing store for a System.
 *
 * Use `type: 'local'` for a local directory and `type: 's3'` for an
 * S3-compatible object store (MinIO, RustFS, etc.).
 */
export type SystemConfig =
  | { type: 'local'; path: string }
  | {
      type: 's3'
      endpoint: string
      port?: number
      accessKey: string
      secretKey: string
      useSSL?: boolean
    }

// ---------------------------------------------------------------------------
// System interface
// ---------------------------------------------------------------------------

/**
 * System is a PocketBase-style filesystem abstraction.
 *
 * It wraps a bucket-scoped IFileStore and provides high-level operations
 * such as Upsert, ReadFile, Delete, ListFiles, and CreateSignedUrl.
 */
export interface System {
  /** Bucket returns the bucket name this system operates on. */
  Bucket(): string

  /**
   * Upsert writes (or overwrites) a file at the given path.
   * Returns a FileHandle for the written file.
   */
  Upsert(name: string, data: ArrayBuffer): Promise<FileHandle>

  /**
   * ReadFile reads a file from the store and returns a FileHandle.
   * Throws if the file does not exist.
   */
  ReadFile(name: string): Promise<FileHandle>

  /**
   * Delete removes a file from the store.
   * Does not throw if the file does not exist.
   */
  Delete(name: string): Promise<void>

  /**
   * ListFiles returns metadata for all files matching the optional prefix.
   */
  ListFiles(prefix?: string): Promise<FileInfo[]>

  /**
   * CreateSignedUrl generates a time-limited signed URL for the file.
   *
   * Only supported by S3System.  LocalSystem throws.
   *
   * @param name       The file path.
   * @param durationMs Lifetime of the signed URL in milliseconds.
   */
  CreateSignedUrl(name: string, durationMs: number): Promise<string>

  /**
   * Exists checks whether a file exists in the store.
   */
  Exists(name: string): Promise<boolean>
}

// ---------------------------------------------------------------------------
// LocalSystem
// ---------------------------------------------------------------------------

/**
 * LocalSystem implements the System interface backed by a LocalFileStore.
 */
export class LocalSystem implements System {
  private bucket: string
  private store: LocalFileStore

  constructor(bucket: string, store: LocalFileStore) {
    this.bucket = bucket
    this.store = store
  }

  Bucket(): string {
    return this.bucket
  }

  async Upsert(name: string, data: ArrayBuffer): Promise<FileHandle> {
    await this.store.save(this.bucket, name, data)
    return new FileHandle(Buffer.from(data), {
      Name: name,
      Size: data.byteLength,
      ContentType: '',
      CreatedAt: new Date(),
      UpdatedAt: new Date(),
    })
  }

  async ReadFile(name: string): Promise<FileHandle> {
    const data = await this.store.read(this.bucket, name)
    // Try to derive ContentType from the file extension
    const contentType = guessContentType(name)
    return new FileHandle(data, {
      Name: name,
      Size: data.length,
      ContentType: contentType,
      CreatedAt: new Date(),
      UpdatedAt: new Date(),
    })
  }

  async Delete(name: string): Promise<void> {
    await this.store.delete(this.bucket, [name])
  }

  async ListFiles(prefix?: string): Promise<FileInfo[]> {
    const files = await this.store.list(this.bucket, prefix)
    return files.map((f) => ({
      Name: f.name,
      Size: (f.metadata?.size as number) ?? 0,
      ContentType: guessContentType(f.name),
      CreatedAt: f.created_at ? new Date(f.created_at) : new Date(),
      UpdatedAt: f.updated_at ? new Date(f.updated_at) : new Date(),
    }))
  }

  async CreateSignedUrl(_name: string, _durationMs: number): Promise<string> {
    throw new Error(
      'CreateSignedUrl is not supported by LocalSystem. Use S3System for signed URLs.',
    )
  }

  async Exists(name: string): Promise<boolean> {
    try {
      await this.store.read(this.bucket, name)
      return true
    } catch {
      return false
    }
  }
}

// ---------------------------------------------------------------------------
// S3System
// ---------------------------------------------------------------------------

/**
 * S3System implements the System interface backed by an S3FileStore.
 *
 * Supports CreateSignedUrl via the S3 presigned URL mechanism.
 */
export class S3System implements System {
  private bucket: string
  private store: S3FileStore

  constructor(bucket: string, store: S3FileStore) {
    this.bucket = bucket
    this.store = store
  }

  Bucket(): string {
    return this.bucket
  }

  async Upsert(name: string, data: ArrayBuffer): Promise<FileHandle> {
    await this.store.save(this.bucket, name, data)
    return new FileHandle(Buffer.from(data), {
      Name: name,
      Size: data.byteLength,
      ContentType: '',
      CreatedAt: new Date(),
      UpdatedAt: new Date(),
    })
  }

  async ReadFile(name: string): Promise<FileHandle> {
    const data = await this.store.read(this.bucket, name)
    const contentType = guessContentType(name)
    return new FileHandle(data, {
      Name: name,
      Size: data.length,
      ContentType: contentType,
      CreatedAt: new Date(),
      UpdatedAt: new Date(),
    })
  }

  async Delete(name: string): Promise<void> {
    await this.store.delete(this.bucket, [name])
  }

  async ListFiles(prefix?: string): Promise<FileInfo[]> {
    const files = await this.store.list(this.bucket, prefix)
    return files.map((f) => ({
      Name: f.name,
      Size: 0,
      ContentType: guessContentType(f.name),
      CreatedAt: f.created_at ? new Date(f.created_at) : new Date(),
      UpdatedAt: f.updated_at ? new Date(f.updated_at) : new Date(),
    }))
  }

  async CreateSignedUrl(name: string, durationMs: number): Promise<string> {
    // Delegate to the S3 store's presigned URL generation.
    // Uses the minio client's presignedGetObject under the hood.
    const url = await this.store.presignedGetUrl(
      this.bucket,
      name,
      Math.ceil(durationMs / 1000),
    )
    return url
  }

  async Exists(name: string): Promise<boolean> {
    try {
      await this.store.read(this.bucket, name)
      return true
    } catch {
      return false
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * NewSystem creates a System backed by either local filesystem or S3,
 * based on the provided config.
 *
 * @param bucket The bucket / directory name to operate in.
 * @param config Storage configuration.
 *
 * @example
 * ```ts
 * // Local storage
 * const sys = NewSystem('my-bucket', { type: 'local', path: '/data/storage' })
 *
 * // S3-compatible storage
 * const sys = NewSystem('my-bucket', {
 *   type: 's3',
 *   endpoint: 'localhost',
 *   accessKey: 'minioadmin',
 *   secretKey: 'minioadmin',
 * })
 * ```
 */
export function NewSystem(bucket: string, config: SystemConfig): System {
  switch (config.type) {
    case 'local': {
      const store = new LocalFileStore(config.path)
      return new LocalSystem(bucket, store)
    }
    case 's3': {
      const store = new S3FileStore({
        endpoint: config.endpoint,
        port: config.port,
        accessKey: config.accessKey,
        secretKey: config.secretKey,
        useSSL: config.useSSL,
      })
      return new S3System(bucket, store)
    }
  }
}

// ---------------------------------------------------------------------------
// Content-type helper
// ---------------------------------------------------------------------------

const mimeTypes: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.ts': 'application/typescript',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.md': 'text/markdown',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
}

function guessContentType(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot === -1) return 'application/octet-stream'
  const ext = name.slice(dot).toLowerCase()
  return mimeTypes[ext] ?? 'application/octet-stream'
}
