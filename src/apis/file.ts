/**
 * Storage API Routes
 *
 * Implements the /storage/v1/* endpoints backed by the local filesystem.
 * Routes mirror the Supabase Storage API for SDK compatibility.
 */
import { Elysia } from 'elysia'
import type { IFileStore } from '../tools/filesystem/store-interface'

/**
 * Create an Elysia plugin that registers all /storage/v1/* routes.
 */
export function createStoragePlugin(store: IFileStore) {
  const app = new Elysia()

  // ── Bucket operations ──

  // GET /storage/v1/bucket — List all buckets
  app.get('/storage/v1/bucket', async () => {
    const data = await store.listBuckets()
    return { data, error: null }
  })

  // POST /storage/v1/bucket — Create a bucket
  app.post(
    '/storage/v1/bucket',
    async ({ body, set }) => {
      const b = (body ?? {}) as Record<string, unknown>
      const name = b['name']
      if (!name || typeof name !== 'string') {
        set.status = 400
        return {
          data: null,
          error: {
            message: 'Bucket name is required',
            details: '',
            hint: '',
            code: '400',
          },
        }
      }
      const data = await store.createBucket(name)
      return { data, error: null }
    },
  )

  // ── Object operations ──

  // POST /storage/v1/object/list/:bucket — List objects in a bucket
  app.post(
    '/storage/v1/object/list/:bucket',
    async ({ params, body, set }) => {
      const bucket = params['bucket']
      if (!bucket) {
        set.status = 400
        return {
          data: null,
          error: {
            message: 'Bucket is required',
            details: '',
            hint: '',
            code: '400',
          },
        }
      }
      await store.ensureBucket(bucket)
      const b = (body ?? {}) as Record<string, unknown>
      const prefix = b['prefix'] as string | undefined
      const data = await store.list(bucket, prefix)
      return { data, error: null }
    },
  )

  // POST /storage/v1/object/:bucket/* — Upload a file
  // Uses Elysia's built-in multipart/form-data parser
  app.post(
    '/storage/v1/object/:bucket/*',
    async ({ body, params, set }) => {
      const bucket = params['bucket']
      const path = params['*']
      if (!bucket || !path) {
        set.status = 400
        return {
          data: null,
          error: {
            message: 'Bucket and path are required',
            details: '',
            hint: '',
            code: '400',
          },
        }
      }
      await store.ensureBucket(bucket)
      // body is the parsed multipart form data flattened into a plain object
      const b = (body ?? {}) as Record<string, unknown>
      const file = b['file'] as Blob | File | null
      if (!file) {
        set.status = 400
        return {
          data: null,
          error: {
            message: 'File is required',
            details: '',
            hint: '',
            code: '400',
          },
        }
      }
      const arrayBuffer = await file.arrayBuffer()
      await store.save(bucket, path, arrayBuffer)
      return { data: { path }, error: null }
    },
    {
      parse: 'multipart/form-data',
    },
  )

  // GET /storage/v1/object/:bucket/* — Download a file
  app.get(
    '/storage/v1/object/:bucket/*',
    async ({ params, set }) => {
      const bucket = params['bucket']
      const path = params['*']
      if (!bucket || !path) {
        set.status = 400
        return {
          data: null,
          error: {
            message: 'Bucket and path are required',
            details: '',
            hint: '',
            code: '400',
          },
        }
      }
      try {
        const buffer = await store.read(bucket, path)
        return new Response(buffer, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(buffer.length),
          },
        })
      } catch {
        set.status = 404
        return {
          data: null,
          error: {
            message: 'Object not found',
            details: '',
            hint: '',
            code: '404',
          },
        }
      }
    },
  )

  // DELETE /storage/v1/object/:bucket — Delete objects
  // Read raw body because Elysia may skip parsing for DELETE requests
  app.delete(
    '/storage/v1/object/:bucket',
    async ({ request, params, set }) => {
      const bucket = params['bucket']
      if (!bucket) {
        set.status = 400
        return {
          data: null,
          error: {
            message: 'Bucket is required',
            details: '',
            hint: '',
            code: '400',
          },
        }
      }
      const raw = await request.text()
      const b = JSON.parse(raw || '{}') as Record<string, unknown>
      const paths = b['paths']
      if (!Array.isArray(paths)) {
        set.status = 400
        return {
          data: null,
          error: {
            message: 'paths array is required',
            details: '',
            hint: '',
            code: '400',
          },
        }
      }
      const deleted = await store.delete(bucket, paths as string[])
      return { data: deleted.map((p: string) => ({ path: p })), error: null }
    },
  )

  // GET /storage/v1/object/public/:bucket/* — Public URL redirect
  app.get(
    '/storage/v1/object/public/:bucket/*',
    async ({ params, set }) => {
      const bucket = params['bucket']
      const path = params['*']
      if (!bucket || !path) {
        set.status = 400
        return {
          data: null,
          error: {
            message: 'Bucket and path are required',
            details: '',
            hint: '',
            code: '400',
          },
        }
      }
      set.redirect = `/storage/v1/object/${bucket}/${path}`
      return {
        data: { publicUrl: `/storage/v1/object/${bucket}/${path}` },
        error: null,
      }
    },
  )

  // POST /storage/v1/object/sign/:bucket/* — Create signed URL
  app.post(
    '/storage/v1/object/sign/:bucket/*',
    async ({ params, body, set }) => {
      const bucket = params['bucket']
      const path = params['*']
      if (!bucket || !path) {
        set.status = 400
        return {
          data: null,
          error: {
            message: 'Bucket and path are required',
            details: '',
            hint: '',
            code: '400',
          },
        }
      }
      const b = (body ?? {}) as Record<string, unknown>
      const expiresIn = b['expiresIn']
      const signedUrl = `/storage/v1/object/${bucket}/${path}${expiresIn ? `?expires=${String(expiresIn)}` : ''}`
      return { data: { signedUrl }, error: null }
    },
  )

  return app
}
