/**
 * Shared file store interface — implemented by both LocalFileStore and S3FileStore.
 */

export interface FileObject {
  name: string
  id: string | null
  updated_at: string | null
  created_at: string | null
  last_accessed_at: string | null
  metadata: Record<string, unknown> | null
}

export interface Bucket {
  id: string
  name: string
  owner: string
  public: boolean
  created_at: string
  updated_at: string
}

export interface IFileStore {
  save(bucket: string, path: string, data: ArrayBuffer): Promise<void>
  read(bucket: string, path: string): Promise<Buffer>
  delete(bucket: string, paths: string[]): Promise<string[]>
  list(bucket: string, prefix?: string): Promise<FileObject[]>
  listBuckets(): Promise<Bucket[]>
  createBucket(name: string): Promise<string>
  ensureBucket(name: string): Promise<void>
}
