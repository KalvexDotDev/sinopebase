/**
 * S3-Compatible Storage Backend — RustFS / MinIO
 *
 * Uses the minio npm package (S3 client) to talk to RustFS.
 * RustFS is S3-compatible (same API as MinIO).
 */

import { Client as MinioClient } from 'minio'
import type { IFileStore } from './store-interface'

export interface S3Config {
  endpoint: string
  port?: number
  accessKey: string
  secretKey: string
  useSSL?: boolean
}

export interface FileObject {
  name: string
  id: string | null
  updated_at: string | null
  created_at: string | null
  last_accessed_at: string | null
  metadata: Record<string, unknown> | null
}

export class S3FileStore implements IFileStore {
  private client: MinioClient

  constructor(config: S3Config) {
    this.client = new MinioClient({
      endPoint: config.endpoint,
      port: config.port ?? 9000,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
      useSSL: config.useSSL ?? false,
    })
  }

  // -----------------------------------------------------------------------
  // Bucket operations
  // -----------------------------------------------------------------------

  async listBuckets(): Promise<Array<{ id: string; name: string; owner: string; public: boolean; created_at: string; updated_at: string }>> {
    const buckets = await this.client.listBuckets()
    return buckets.map((b) => ({
      id: b.name,
      name: b.name,
      owner: '',
      public: false,
      created_at: b.creationDate?.toISOString() ?? new Date().toISOString(),
      updated_at: b.creationDate?.toISOString() ?? new Date().toISOString(),
    }))
  }

  async createBucket(name: string): Promise<string> {
    const exists = await this.client.bucketExists(name)
    if (!exists) {
      await this.client.makeBucket(name)
    }
    return name
  }

  async ensureBucket(name: string): Promise<void> {
    const exists = await this.client.bucketExists(name)
    if (!exists) {
      await this.client.makeBucket(name)
    }
  }

  // -----------------------------------------------------------------------
  // Object operations
  // -----------------------------------------------------------------------

  async save(bucket: string, path: string, data: ArrayBuffer): Promise<void> {
    await this.ensureBucket(bucket)
    await this.client.putObject(bucket, path, Buffer.from(data), data.byteLength)
  }

  async read(bucket: string, path: string): Promise<Buffer> {
    const stream = await this.client.getObject(bucket, path)
    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer)
    }
    return Buffer.concat(chunks)
  }

  async delete(bucket: string, paths: string[]): Promise<string[]> {
    await this.client.removeObjects(bucket, paths)
    return paths
  }

  async list(bucket: string, prefix?: string): Promise<FileObject[]> {
    const stream = this.client.listObjects(bucket, prefix, false)
    const objects: FileObject[] = []
    for await (const obj of stream) {
      objects.push({
        name: obj.name ?? '',
        id: obj.name ?? null,
        updated_at: obj.lastModified?.toISOString() ?? null,
        created_at: obj.lastModified?.toISOString() ?? null,
        last_accessed_at: null,
        metadata: null,
      })
    }
    return objects
  }

  // -----------------------------------------------------------------------
  // Signed URL
  // -----------------------------------------------------------------------

  /**
   * Generate a presigned GET URL for a file.
   *
   * @param bucket   The bucket name.
   * @param path     The object path.
   * @param ttlSec   Time-to-live in seconds (default 3600).
   */
  async presignedGetUrl(bucket: string, path: string, ttlSec: number = 3600): Promise<string> {
    return this.client.presignedGetObject(bucket, path, ttlSec)
  }
}
