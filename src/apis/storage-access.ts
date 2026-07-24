import type { Bucket, FileObject } from '../tools/filesystem/store-interface'
import type { PostgresRequestContext } from '../core/db-postgres'

export interface StorageBucketInput {
  name: string
  public: boolean
  fileSizeLimit?: number | null
  allowedMimeTypes?: string[] | null
}

export interface StorageUploadInput {
  bucket: string
  path: string
  data: ArrayBuffer
  contentType: string
  cacheControl?: string
  upsert: boolean
}

export interface StorageAccessPolicy {
  isAvailable(): Promise<boolean>
  listBuckets(context: PostgresRequestContext): Promise<Bucket[]>
  createBucket(
    context: PostgresRequestContext,
    input: StorageBucketInput,
    persist: () => Promise<unknown>,
  ): Promise<void>
  listObjects(
    context: PostgresRequestContext,
    bucket: string,
    prefix?: string,
  ): Promise<FileObject[]>
  upload(
    context: PostgresRequestContext,
    input: StorageUploadInput,
    persist: () => Promise<unknown>,
  ): Promise<void>
  download(
    context: PostgresRequestContext,
    bucket: string,
    path: string,
    read: () => Promise<Buffer>,
  ): Promise<Buffer>
  remove(
    context: PostgresRequestContext,
    bucket: string,
    paths: string[],
    persist: (allowedPaths: string[]) => Promise<string[]>,
  ): Promise<string[]>
  authorizeSignedUrl(
    context: PostgresRequestContext,
    bucket: string,
    path: string,
  ): Promise<void>
  downloadPublic(
    bucket: string,
    path: string,
    read: () => Promise<Buffer>,
  ): Promise<Buffer>
}

export class StorageAccessError extends Error {
  readonly status: number
  readonly code: string

  constructor(
    status: number,
    code: string,
    message: string,
  ) {
    super(message)
    this.name = 'StorageAccessError'
    this.status = status
    this.code = code
  }
}

export function validateBucketConstraints(
  bucket: { fileSizeLimit: number | null; allowedMimeTypes: string[] | null },
  upload: Pick<StorageUploadInput, 'data' | 'contentType'>,
): void {
  if (bucket.fileSizeLimit !== null && upload.data.byteLength > bucket.fileSizeLimit) {
    throw new StorageAccessError(413, '413', 'The object exceeds the bucket file size limit')
  }

  if (bucket.allowedMimeTypes?.length) {
    const mime = normalizeMimeType(upload.contentType)
    const allowed = bucket.allowedMimeTypes.some((pattern) => mimeMatches(pattern, mime))
    if (!allowed) {
      throw new StorageAccessError(415, '415', `MIME type ${mime} is not allowed in this bucket`)
    }
  }
}

function normalizeMimeType(value: string): string {
  return value.split(';', 1)[0]?.trim().toLowerCase() || 'application/octet-stream'
}

function mimeMatches(pattern: string, mime: string): boolean {
  const normalized = pattern.trim().toLowerCase()
  if (normalized === mime || normalized === '*/*') return true
  if (!normalized.endsWith('/*')) return false
  return mime.startsWith(`${normalized.slice(0, -1)}`)
}
