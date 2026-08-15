/**
 * Storage Client (stub — implemented in Phase 3)
 *
 * Mirrors @supabase/storage-js.
 * Backed by S3-compatible storage via Sinopebase /storage/v1 endpoints.
 */

import type { PostgrestError } from './client'

export interface StorageClient {
  from(bucket: string): StorageBucket
  listBuckets(): Promise<{ data: Bucket[] | null; error: PostgrestError | null }>
  createBucket(
    name: string,
    options?: { public?: boolean },
  ): Promise<{ data: string | null; error: PostgrestError | null }>
  getBucket(name: string): Promise<{ data: Bucket | null; error: PostgrestError | null }>
  updateBucket(
    name: string,
    options?: { public?: boolean },
  ): Promise<{ data: string | null; error: PostgrestError | null }>
  deleteBucket(name: string): Promise<{ data: string | null; error: PostgrestError | null }>
}

export interface StorageBucket {
  upload(
    path: string,
    file: File | Blob | Buffer,
    options?: UploadOptions,
  ): Promise<{ data: { path: string } | null; error: PostgrestError | null }>
  download(path: string): Promise<{ data: Blob | null; error: PostgrestError | null }>
  remove(
    paths: string | string[],
  ): Promise<{ data: { path: string }[] | null; error: PostgrestError | null }>
  list(
    path?: string,
    options?: ListOptions,
  ): Promise<{ data: FileObject[] | null; error: PostgrestError | null }>
  getPublicUrl(path: string): { data: { publicUrl: string } }
  createSignedUrl(
    path: string,
    expiresIn: number,
  ): Promise<{ data: { signedUrl: string } | null; error: PostgrestError | null }>
  createSignedUrls(
    paths: string[],
    expiresIn: number,
  ): Promise<{ data: { path: string; signedUrl: string }[] | null; error: PostgrestError | null }>
  copy(
    fromPath: string,
    toPath: string,
  ): Promise<{ data: { path: string } | null; error: PostgrestError | null }>
  move(
    fromPath: string,
    toPath: string,
  ): Promise<{ data: { path: string } | null; error: PostgrestError | null }>
  exists(path: string): Promise<{ data: boolean; error: PostgrestError | null }>
}

export interface Bucket {
  id: string
  name: string
  owner: string
  public: boolean
  created_at: string
  updated_at: string
}

export interface FileObject {
  name: string
  id: string | null
  updated_at: string | null
  created_at: string | null
  last_accessed_at: string | null
  metadata: Record<string, unknown> | null
}

export interface UploadOptions {
  cacheControl?: string
  contentType?: string
  upsert?: boolean
}

export interface ListOptions {
  limit?: number
  offset?: number
  sortBy?: { column: string; order: 'asc' | 'desc' }
}
