/**
 * Body size limit enforcement middleware for Elysia.
 *
 * Port of PocketBase apis/middlewares_body_limit.go
 * Layer 4 — imports from ~/tools/*.
 *
 * Replaces the request body stream with a limited reader that aborts with
 * a 413 Payload Too Large error if the body exceeds the configured limit.
 *
 * Also performs an optimistic check against `Content-Length` before
 * reading the body.
 */

import { RequestEntityTooLargeError } from './api_error_aliases'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default maximum body size (32 MiB). */
export const DEFAULT_MAX_BODY_SIZE = 32 * 1024 * 1024

/** Default maximum upload size (100 MiB). */
export const DEFAULT_MAX_UPLOAD_SIZE = 100 * 1024 * 1024

// ---------------------------------------------------------------------------
// Limited reader
// ---------------------------------------------------------------------------

/**
 * Wraps a [[ReadableStream]] so that it throws once the cumulative read
 * exceeds `limitBytes`.
 */
class LimitedStream extends ReadableStream<Uint8Array> {
  constructor(source: ReadableStream<Uint8Array>, limitBytes: number) {
    let totalRead = 0

    super({
      async pull(controller) {
        const reader = source.getReader()
        try {
          const { done, value } = await reader.read()
          if (done) {
            controller.close()
            return
          }
          totalRead += value.byteLength
          if (totalRead > limitBytes) {
            controller.error(
              new RequestEntityTooLargeError(`Request body exceeds the ${limitBytes} byte limit.`),
            )
            return
          }
          controller.enqueue(value)
        } finally {
          reader.releaseLock()
        }
      },
      cancel(reason) {
        source.cancel(reason)
      },
    })
  }
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Returns an Elysia **before-handle** hook that enforces a request body
 * size limit.
 *
 * If `limitBytes <= 0` the limit is disabled.
 *
 * The check works in two stages:
 * 1. Optimistic: compare `content-length` header against the limit.
 * 2. Runtime: wrap the body stream with [[LimitedStream]] so over-large
 *    payloads that lied about Content-Length are still caught.
 */
export function bodyLimit(limitBytes: number) {
  return async (ctx: { request: Request; set: { status?: number } }) => {
    if (limitBytes <= 0) return

    // Optimistic check
    const contentLength = Number(ctx.request.headers.get('content-length') ?? 0)
    if (contentLength > limitBytes) {
      throw new RequestEntityTooLargeError(`Request body exceeds the ${limitBytes} byte limit.`)
    }

    // If the body is already consumed or empty, nothing to do.
    if (ctx.request.body === null) return

    // Replace the body stream with a limited reader.
    // We create a new Request with the limited stream so that Elysia's
    // body parser reads through our wrapper.
    const limited = new LimitedStream(ctx.request.body as ReadableStream<Uint8Array>, limitBytes)

    // Patch the request body — use the low-level approach since
    // Elysia reads from `request.body` (a ReadableStream).
    Object.defineProperty(ctx.request, 'body', {
      get: () => limited,
      configurable: true,
    })
  }
}

// ---------------------------------------------------------------------------
// Upload body limit
// ---------------------------------------------------------------------------

/**
 * Returns an Elysia **onRequest** hook that enforces an upload body size
 * limit by checking the `Content-Length` header before any body parsing
 * occurs.
 *
 * This is a lighter-weight check than [[bodyLimit]] — it does NOT wrap the
 * body stream. It is intended to run as a pre-parse guard on upload routes
 * so that oversized requests are rejected with 413 before any body bytes
 * are read.
 *
 * If `maxBytes <= 0` the limit is disabled.
 */
export function uploadBodyLimit(maxBytes?: number) {
  const limit = maxBytes ?? DEFAULT_MAX_UPLOAD_SIZE
  return async (ctx: { request: Request; set: { status?: number } }) => {
    if (limit <= 0) return

    const contentLength = Number(ctx.request.headers.get('content-length') ?? 0)
    if (contentLength > limit) {
      throw new RequestEntityTooLargeError(`Upload body exceeds the ${limit} byte limit.`)
    }
  }
}
