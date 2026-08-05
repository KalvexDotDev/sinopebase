/**
 * Storage Client Implementation
 *
 * Real HTTP calls to Sinopebase /storage/v1 endpoints.
 * Backend returns 404/501 until Phase 3 (Storage) is ported.
 */

import type { PostgrestError } from './client'
import type {
  Bucket,
  FileObject,
  ListOptions,
  StorageBucket,
  StorageClient,
  UploadOptions,
} from './storage'

export function createStorageClient(baseUrl: string, apiKey: string): StorageClient {
  const headers = {
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
  }

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const reqHeaders: Record<string, string> = { ...headers, ...extraHeaders }
    let reqBody: string | Blob | FormData | undefined
    if (body !== undefined) {
      if (body instanceof FormData) {
        reqBody = body
      } else {
        reqBody = JSON.stringify(body)
        if (!reqHeaders['Content-Type']) reqHeaders['Content-Type'] = 'application/json'
      }
    }
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: reqHeaders,
      body: reqBody,
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) {
      return {
        data: null,
        error: {
          message: ((json as Record<string, unknown> | null)?.message as string) ?? res.statusText,
          details: '',
          hint: '',
          code: String(res.status),
        },
      } as T
    }
    return json as T
  }

  return {
    from(bucket: string): StorageBucket {
      return {
        async upload(path: string, file: Blob | Buffer, options?: UploadOptions) {
          const form = new FormData()
          form.append('file', file instanceof Blob ? file : new Blob([file as BlobPart]))
          if (options?.upsert) form.append('upsert', 'true')
          // Don't set Content-Type for FormData — browser/fetch auto-sets boundary
          const { 'content-type': _, ...restHeaders } = headers as Record<string, string>
          const res = await fetch(`${baseUrl}/storage/v1/object/${bucket}/${path}`, {
            method: 'POST',
            headers: restHeaders,
            body: form,
          })
          const json = await res.json().catch(() => null)
          if (!res.ok) {
            return {
              data: null,
              error: {
                message:
                  ((json as Record<string, unknown> | null)?.message as string) ?? res.statusText,
                details: '',
                hint: '',
                code: String(res.status),
              },
            }
          }
          const raw = json as
            | { Key?: string }
            | { data?: { path: string } | null; error?: PostgrestError | null }
          if (raw && 'Key' in raw) return { data: { path }, error: null }
          return raw as { data: { path: string } | null; error: PostgrestError | null }
        },
        async download(path: string) {
          const res = await fetch(`${baseUrl}/storage/v1/object/${bucket}/${path}`, { headers })
          if (!res.ok)
            return {
              data: null,
              error: { message: res.statusText, details: '', hint: '', code: String(res.status) },
            }
          return { data: await res.blob(), error: null }
        },
        async remove(paths) {
          const result = await request<
            | { name?: string; path?: string }[]
            | { data: { path: string }[] | null; error: PostgrestError | null }
          >('DELETE', `/storage/v1/object/${bucket}`, {
            paths: Array.isArray(paths) ? paths : [paths],
          })
          if (Array.isArray(result))
            return {
              data: result.map((item) => ({ path: item.path ?? item.name ?? '' })),
              error: null,
            }
          return result
        },
        async list(_path?: string, _options?: ListOptions) {
          const result = await request<
            FileObject[] | { data: FileObject[] | null; error: PostgrestError | null }
          >('POST', `/storage/v1/object/list/${bucket}`, { prefix: _path, ..._options })
          return Array.isArray(result) ? { data: result, error: null } : result
        },
        getPublicUrl(path: string) {
          return { data: { publicUrl: `${baseUrl}/storage/v1/object/public/${bucket}/${path}` } }
        },
        async createSignedUrl(path: string, expiresIn: number) {
          const result = await request<{
            signedURL?: string
            data?: { signedUrl: string } | null
            error?: PostgrestError | null
          }>('POST', `/storage/v1/object/sign/${bucket}/${path}`, { expiresIn })
          if (result.signedURL)
            return { data: { signedUrl: `${baseUrl}${result.signedURL}` }, error: null }
          return result as { data: { signedUrl: string } | null; error: PostgrestError | null }
        },

        async createSignedUrls(paths: string[], expiresIn: number) {
          const result = await request<{
            data?: { path: string; signedUrl: string }[] | null
            error?: PostgrestError | null
          }>('POST', `/storage/v1/object/sign/${bucket}`, { paths, expiresIn })
          return result as {
            data: { path: string; signedUrl: string }[] | null
            error: PostgrestError | null
          }
        },

        async copy(fromPath: string, toPath: string) {
          const result = await request<{
            data?: { path: string } | null
            error?: PostgrestError | null
          }>('POST', `/storage/v1/object/copy`, {
            bucket,
            from: fromPath,
            to: toPath,
          })
          return result as { data: { path: string } | null; error: PostgrestError | null }
        },

        async move(fromPath: string, toPath: string) {
          const result = await request<{
            data?: { path: string } | null
            error?: PostgrestError | null
          }>('POST', `/storage/v1/object/move`, {
            bucket,
            from: fromPath,
            to: toPath,
          })
          return result as { data: { path: string } | null; error: PostgrestError | null }
        },

        async exists(path: string) {
          const res = await fetch(`${baseUrl}/storage/v1/object/${bucket}/${path}`, {
            method: 'HEAD',
            headers,
          })
          return { data: res.ok, error: null }
        },
      }
    },

    async listBuckets() {
      const result = await request<
        Bucket[] | { data: Bucket[] | null; error: PostgrestError | null }
      >('GET', '/storage/v1/bucket')
      return Array.isArray(result) ? { data: result, error: null } : result
    },

    async createBucket(name: string, options?: { public?: boolean }) {
      const result = await request<{ name?: string; data?: string; error?: PostgrestError | null }>(
        'POST',
        '/storage/v1/bucket',
        { name, public: options?.public ?? false },
      )
      if (result.name) return { data: result.name, error: null }
      return result as { data: string; error: PostgrestError | null }
    },

    async getBucket(name: string) {
      const result = await request<Bucket | { data: Bucket | null; error: PostgrestError | null }>(
        'GET',
        `/storage/v1/bucket/${name}`,
      )
      if ('id' in result) return { data: result, error: null }
      return result
    },

    async updateBucket(name: string, options?: { public?: boolean }) {
      const result = await request<{ name?: string; data?: string; error?: PostgrestError | null }>(
        'PATCH',
        `/storage/v1/bucket/${name}`,
        { public: options?.public },
      )
      if (result.name) return { data: result.name, error: null }
      return result as { data: string; error: PostgrestError | null }
    },

    async deleteBucket(name: string) {
      const result = await request<{ message?: string; error?: PostgrestError | null }>(
        'DELETE',
        `/storage/v1/bucket/${name}`,
      )
      if (result.message) return { data: result.message, error: null }
      return result as { data: string; error: PostgrestError | null }
    },
  }
}
