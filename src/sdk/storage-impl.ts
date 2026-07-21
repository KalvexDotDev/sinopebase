/**
 * Storage Client Implementation
 *
 * Real HTTP calls to Sinopebase /storage/v1 endpoints.
 * Backend returns 404/501 until Phase 3 (Storage) is ported.
 */

import type {
  StorageClient, StorageBucket, Bucket, FileObject,
  UploadOptions, ListOptions,
} from './storage'
import type { PostgrestError } from './client'

export function createStorageClient(baseUrl: string, apiKey: string): StorageClient {
  const headers = {
    'apikey': apiKey,
    'Authorization': `Bearer ${apiKey}`,
  }

  async function request<T>(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...headers, ...extraHeaders },
      body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined,
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) {
      return {
        data: null,
        error: { message: json?.message ?? res.statusText, details: '', hint: '', code: String(res.status) },
      } as T
    }
    return json as T
  }

  return {
    from(bucket: string): StorageBucket {
      return {
        async upload(path: string, file: Blob | Buffer, options?: UploadOptions) {
          const form = new FormData()
          form.append('file', file instanceof Blob ? file : new Blob([file]))
          if (options?.upsert) form.append('upsert', 'true')
          // Don't set Content-Type for FormData — browser/fetch auto-sets boundary
          const { 'content-type': _, ...restHeaders } = headers
          const res = await fetch(`${baseUrl}/storage/v1/object/${bucket}/${path}`, {
            method: 'POST',
            headers: restHeaders,
            body: form,
          })
          const json = await res.json().catch(() => null)
          if (!res.ok) {
            return { data: null, error: { message: json?.message ?? res.statusText, details: '', hint: '', code: String(res.status) } }
          }
          return json as { data: { path: string } | null; error: PostgrestError | null }
        },
        async download(path: string) {
          const res = await fetch(`${baseUrl}/storage/v1/object/${bucket}/${path}`, { headers })
          if (!res.ok) return { data: null, error: { message: res.statusText, details: '', hint: '', code: String(res.status) } }
          return { data: await res.blob(), error: null }
        },
        async remove(paths) {
          return request<{ data: { path: string }[] | null; error: PostgrestError | null }>(
            'DELETE', `/storage/v1/object/${bucket}`, { paths: Array.isArray(paths) ? paths : [paths] },
          )
        },
        async list(_path?: string, _options?: ListOptions) {
          return request<{ data: FileObject[] | null; error: PostgrestError | null }>(
            'POST', `/storage/v1/object/list/${bucket}`, { prefix: _path, ..._options },
          )
        },
        getPublicUrl(path: string) {
          return { data: { publicUrl: `${baseUrl}/storage/v1/object/public/${bucket}/${path}` } }
        },
        async createSignedUrl(path: string, expiresIn: number) {
          return request<{ data: { signedUrl: string } | null; error: PostgrestError | null }>(
            'POST', `/storage/v1/object/sign/${bucket}/${path}`, { expiresIn },
          )
        },
      }
    },

    async listBuckets() {
      return request<{ data: Bucket[] | null; error: PostgrestError | null }>('GET', '/storage/v1/bucket')
    },

    async createBucket(name: string, options?: { public?: boolean }) {
      return request<{ data: string; error: PostgrestError | null }>(
        'POST', '/storage/v1/bucket', { name, public: options?.public ?? false },
      )
    },
  }
}
