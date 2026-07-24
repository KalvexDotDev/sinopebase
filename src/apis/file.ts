/**
 * Storage API Routes
 *
 * Implements the /storage/v1/* endpoints backed by the local filesystem.
 * Routes mirror the Supabase Storage API for SDK compatibility.
 */
import { Elysia } from 'elysia'
import type { IFileStore } from '../tools/filesystem/store-interface'
import type { PostgresRequestContext } from '../core/db-postgres'
import {
  StorageAccessError,
  type StorageAccessPolicy,
} from './storage-access'

interface ParsedUploadBody {
  data: ArrayBuffer
  contentType: string
  fields: Record<string, string>
}

export interface StoragePluginOptions {
  resolveContext?: (request: Request) => PostgresRequestContext | undefined
  access?: StorageAccessPolicy
}

function exactArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
}

function isParsedUploadBody(value: unknown): value is ParsedUploadBody {
  return typeof value === 'object' && value !== null
    && 'data' in value && value.data instanceof ArrayBuffer
    && 'fields' in value
}

async function parseUploadBody(request: Request, contentType: string): Promise<ParsedUploadBody> {
  const raw = Buffer.from(await request.arrayBuffer())
  if (!contentType.startsWith('multipart/form-data')) {
    return { data: exactArrayBuffer(raw), contentType, fields: {} }
  }

  // Bun's FormData parser discards fields whose name is empty, while
  // storage-js deliberately uploads Blob/File data under `name=""`.
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)?.slice(1).find(Boolean)
  if (!boundary) return { data: new ArrayBuffer(0), contentType: '', fields: {} }

  const delimiter = Buffer.from(`--${boundary}`)
  const nextDelimiter = Buffer.from(`\r\n--${boundary}`)
  const fields: Record<string, string> = {}
  let fileData = new ArrayBuffer(0)
  let fileContentType = ''
  let partStart = raw.indexOf(delimiter)
  while (partStart !== -1) {
    const headerStart = partStart + delimiter.length + 2
    const headerEnd = raw.indexOf('\r\n\r\n', headerStart)
    if (headerEnd === -1) break
    const bodyStart = headerEnd + 4
    const bodyEnd = raw.indexOf(nextDelimiter, bodyStart)
    if (bodyEnd === -1) break
    const headers = raw.subarray(headerStart, headerEnd).toString('utf8')
    if (/content-disposition:\s*form-data;[^\r\n]*filename=/i.test(headers)) {
      fileData = exactArrayBuffer(raw.subarray(bodyStart, bodyEnd))
      fileContentType = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() ?? ''
    } else {
      const name = /content-disposition:\s*form-data;[^\r\n]*name="([^"]*)"/i.exec(headers)?.[1]
      if (name) fields[name] = raw.subarray(bodyStart, bodyEnd).toString('utf8')
    }
    partStart = raw.indexOf(delimiter, bodyEnd + 2)
  }

  return { data: fileData, contentType: fileContentType, fields }
}

async function resolveStorageAccess(options: StoragePluginOptions, request: Request) {
  const context = options.resolveContext?.(request)
  if (!context) throw new StorageAccessError(401, '401', 'Authorization required')
  if (options.access && await options.access.isAvailable()) {
    return { context, access: options.access }
  }
  if (context.role === 'service_role') return { context, access: undefined }
  throw new StorageAccessError(503, '503', 'Supabase storage metadata schema is unavailable')
}

async function storageOperation<T>(
  set: { status?: number | string },
  operation: () => Promise<T>,
): Promise<T | { statusCode: string; error: string; message: string }> {
  try {
    return await operation()
  } catch (error) {
    const failure = error instanceof StorageAccessError
      ? error
      : new StorageAccessError(500, '500', 'Storage operation failed')
    set.status = failure.status
    return { statusCode: failure.code, error: failure.code, message: failure.message }
  }
}

/**
 * Create an Elysia plugin that registers all /storage/v1/* routes.
 */
export function createStoragePlugin(store: IFileStore, options: StoragePluginOptions = {}) {
  const app = new Elysia()

  // ── Bucket operations ──

  // GET /storage/v1/bucket — List all buckets
  app.get('/storage/v1/bucket', async ({ request, set }) => {
    return storageOperation(set, async () => {
      const { context, access } = await resolveStorageAccess(options, request)
      return access ? access.listBuckets(context) : store.listBuckets()
    })
  })

  // POST /storage/v1/bucket — Create a bucket
  app.post(
    '/storage/v1/bucket',
    async ({ body, request, set }) => {
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
      return storageOperation(set, async () => {
        const { context, access } = await resolveStorageAccess(options, request)
        if (access) {
          await access.createBucket(context, {
            name,
            public: b['public'] === true,
            fileSizeLimit: typeof b['file_size_limit'] === 'number'
              ? b['file_size_limit']
              : typeof b['fileSizeLimit'] === 'number' ? b['fileSizeLimit'] : null,
            allowedMimeTypes: Array.isArray(b['allowed_mime_types'])
              ? b['allowed_mime_types'] as string[]
              : Array.isArray(b['allowedMimeTypes']) ? b['allowedMimeTypes'] as string[] : null,
          }, () => store.createBucket(name))
        } else {
          await store.createBucket(name)
        }
        return { name }
      })
    },
  )

  // ── Object operations ──

  // POST /storage/v1/object/list/:bucket — List objects in a bucket
  app.post(
    '/storage/v1/object/list/:bucket',
    async ({ params, body, request, set }) => {
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
      const b = (body ?? {}) as Record<string, unknown>
      const prefix = b['prefix'] as string | undefined
      return storageOperation(set, async () => {
        const { context, access } = await resolveStorageAccess(options, request)
        if (access) return access.listObjects(context, bucket, prefix)
        await store.ensureBucket(bucket)
        return store.list(bucket, prefix)
      })
    },
  )

  // POST /storage/v1/object/:bucket/* — Upload a file
  // Supports the raw and multipart bodies emitted by storage-js.
  app.post(
    '/storage/v1/object/:bucket/*',
    async ({ body, params, request, set }) => {
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
      // storage-js sends Blob/File as multipart (with an empty field name), but
      // sends Buffer/ArrayBuffer as the raw request body. Sinope's evidence
      // endpoint uses Buffer, so both representations are part of the contract.
      const contentType = request.headers.get('content-type') ?? ''
      let data: ArrayBuffer | null = null
      let uploadContentType = contentType
      let fields: Record<string, string> = {}
      if (isParsedUploadBody(body)) {
        data = body.data
        uploadContentType = body.contentType || contentType
        fields = body.fields
      } else if (body instanceof ArrayBuffer) {
        data = body
      } else if (contentType.startsWith('multipart/form-data')) {
        const values = body instanceof FormData
          ? [...body.values()]
          : Object.values((body ?? {}) as Record<string, unknown>)
        const file = values.find((value) => value instanceof Blob)
        if (file instanceof Blob) data = await file.arrayBuffer()
      } else if (body instanceof Blob) {
        data = await body.arrayBuffer()
      } else if (typeof body === 'string') {
        data = new TextEncoder().encode(body).buffer
      } else if (ArrayBuffer.isView(body)) {
        data = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer
      } else {
        data = await request.arrayBuffer()
      }
      if (!data) {
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
      return storageOperation(set, async () => {
        const { context, access } = await resolveStorageAccess(options, request)
        if (access) {
          await access.upload(context, {
            bucket,
            path,
            data,
            contentType: uploadContentType,
            cacheControl: fields['cacheControl'] ?? request.headers.get('cache-control') ?? undefined,
            upsert: fields['upsert'] === 'true' || request.headers.get('x-upsert') === 'true',
          }, async () => {
            await store.ensureBucket(bucket)
            return store.save(bucket, path, data)
          })
        } else {
          await store.ensureBucket(bucket)
          await store.save(bucket, path, data)
        }
        return { Id: `${bucket}/${path}`, Key: `${bucket}/${path}` }
      })
    },
    {
      // Elysia's default form-data parser drops the empty field name used by
      // storage-js. Preserve FormData, and preserve raw upload bytes too.
      parse: ({ request }) => parseUploadBody(request, request.headers.get('content-type') ?? ''),
    },
  )

  // GET /storage/v1/object/:bucket/* — Download a file
  app.get(
    '/storage/v1/object/:bucket/*',
    async ({ params, request, set }) => {
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
      return storageOperation(set, async () => {
        const { context, access } = await resolveStorageAccess(options, request)
        const buffer = access
          ? await access.download(context, bucket, path, () => store.read(bucket, path))
          : await store.read(bucket, path)
        return new Response(buffer, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(buffer.length),
          },
        })
      })
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
      // Supabase storage-js calls this field `prefixes`. Keep `paths` as an
      // alias for Sinopebase's bundled SDK and older clients.
      const paths = b['prefixes'] ?? b['paths']
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
      return storageOperation(set, async () => {
        const { context, access } = await resolveStorageAccess(options, request)
        const deleted = access
          ? await access.remove(context, bucket, paths as string[], (allowed) => store.delete(bucket, allowed))
          : await store.delete(bucket, paths as string[])
        return deleted.map((name: string) => ({ name, bucket_id: bucket }))
      })
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
      return storageOperation(set, async () => {
        if (!options.access || !(await options.access.isAvailable())) {
          throw new StorageAccessError(503, '503', 'Supabase storage metadata schema is unavailable')
        }
        const buffer = await options.access.downloadPublic(bucket, path, () => store.read(bucket, path))
        return new Response(buffer, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(buffer.length),
          },
        })
      })
    },
  )

  // POST /storage/v1/object/sign/:bucket/* — Create signed URL
  app.post(
    '/storage/v1/object/sign/:bucket/*',
    async ({ params, body, request, set }) => {
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
      return storageOperation(set, async () => {
        const { context, access } = await resolveStorageAccess(options, request)
        if (access) await access.authorizeSignedUrl(context, bucket, path)
        const signedURL = `/storage/v1/object/${bucket}/${path}${expiresIn ? `?expires=${String(expiresIn)}` : ''}`
        return { signedURL }
      })
    },
  )

  return app
}
