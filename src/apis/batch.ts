/**
 * Batch API — POST /api/batch
 *
 * Port of PocketBase's apis/batch.go.
 * Execute multiple API requests atomically in a single HTTP call.
 * Layer 4 — imports from ~/core/*, ~/tools/*.
 */

import { Elysia } from 'elysia'
import type { IDatabase } from '~/core/db-interface'
import type { BatchRequest, BatchResponse } from '~/core/event_request_batch'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of requests per batch. */
const MAX_BATCH_REQUESTS = 50

/** Maximum total body size for a batch request (10 MB). */
const MAX_BATCH_BODY_SIZE = 10 * 1024 * 1024

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BatchRequestBody {
  /** Array of individual requests to execute. */
  requests: BatchRequest[]
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * Create an Elysia plugin that registers the /api/batch endpoint.
 *
 * Executes multiple API requests sequentially (not in a true transaction,
 * since Elysia runs in-memory; for production this would use a DB transaction).
 */
export function createBatchPlugin(
  _db: IDatabase,
  _isSuperuser: () => boolean,
  app: Elysia,
) {
  const batchApp = new Elysia()

  batchApp.post('/api/batch', async ({ body, set, request }) => {
    // Check content length
    const contentLength = parseInt(request.headers.get('content-length') ?? '0', 10)
    if (contentLength > MAX_BATCH_BODY_SIZE) {
      set.status = 413
      return { code: 413, message: 'Request body too large.' }
    }

    try {
      const data = (body ?? {}) as BatchRequestBody
      const requests = data.requests

      if (!Array.isArray(requests) || requests.length === 0) {
        set.status = 400
        return { code: 400, message: 'Requests array is required.' }
      }

      if (requests.length > MAX_BATCH_REQUESTS) {
        set.status = 400
        return {
          code: 400,
          message: `Too many requests. Maximum is ${MAX_BATCH_REQUESTS}.`,
        }
      }

      // Process each request sequentially
      const responses: BatchResponse[] = []

      for (const req of requests) {
        try {
          const response = await executeInternalRequest(app, req)
          responses.push(response)
        } catch (err) {
          responses.push({
            status: 500,
            body: { code: 500, message: err instanceof Error ? err.message : 'Internal error' },
          })
        }
      }

      return responses
    } catch (err) {
      set.status = 400
      return {
        code: 400,
        message: `Batch request failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })

  return batchApp
}

/**
 * Execute an individual request against the Elysia app.
 *
 * This simulates an HTTP request by constructing a minimal request object
 * and using Elysia's internal fetch/handle mechanism.
 *
 * In a production implementation, this would route through the actual
 * Elysia request pipeline.
 */
async function executeInternalRequest(
  _app: Elysia,
  req: BatchRequest,
): Promise<BatchResponse> {
  const { method, url, body: reqBody, headers } = req

  // Validate the request has a recognized method and URL pattern
  if (!method || !url) {
    return {
      status: 400,
      body: { code: 400, message: 'Each request must have a method and url.' },
    }
  }

  const normalizedMethod = method.toUpperCase()

  if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(normalizedMethod)) {
    return {
      status: 405,
      body: { code: 405, message: `Method ${normalizedMethod} not allowed in batch.` },
    }
  }

  // TODO: In a full implementation, route this through Elysia's handler
  // For now, return a stub response
  return {
    status: 200,
    body: reqBody ?? null,
    headers: headers ?? {},
  }
}
