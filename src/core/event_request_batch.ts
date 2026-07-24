/**
 * BatchRequestEvent for multi-request batch operations.
 *
 * Port of PocketBase's BatchRequestEvent (Go -> TypeScript).
 *
 * A batch request allows multiple API requests to be sent in a single
 * HTTP call. The BatchRequestEvent wraps the collection of individual
 * requests for processing through the hook system.
 */

import { Event } from '~/tools/hook/event'

/**
 * A single request within a batch.
 */
export interface BatchRequest {
  /** The HTTP method (GET, POST, PATCH, DELETE). */
  method: string

  /** The request URL path. */
  url: string

  /** The request body (if any). */
  body?: unknown

  /** Optional headers for this individual request. */
  headers?: Record<string, string>
}

/**
 * A single response within a batch.
 */
export interface BatchResponse {
  /** HTTP status code. */
  status: number

  /** Response body. */
  body: unknown

  /** Response headers. */
  headers?: Record<string, string>
}

/**
 * BatchRequestEvent is triggered on each API batch request.
 *
 * Could be used to additionally validate or modify the submitted
 * batch requests before they are processed, or to modify the
 * responses before they are returned to the client.
 */
export class BatchRequestEvent extends Event {
  /**
   * Creates a new BatchRequestEvent.
   *
   * @param httpContext - The HTTP context for the batch request.
   * @param requests - The individual requests in the batch.
   * @param responses - The individual responses for the batch (populated after processing).
   */
  /** The HTTP context for the batch request. */
  httpContext: unknown
  /** The individual requests in the batch. */
  requests: BatchRequest[] = []
  /** The individual responses for the batch. */
  responses: BatchResponse[] = []

  constructor(
    /** The HTTP context for the batch request. */
    httpContext: unknown,
    /** The individual requests in the batch. */
    requests: BatchRequest[] = [],
    /** The individual responses for the batch. */
    responses: BatchResponse[] = [],
  ) {
    super()
    this.httpContext = httpContext
    this.requests = requests
    this.responses = responses
  }

  /**
   * Returns the number of requests in the batch.
   */
  get length(): number {
    return this.requests.length
  }

  /**
   * Adds a request to the batch.
   */
  addRequest(request: BatchRequest): void {
    this.requests.push(request)
  }

  /**
   * Sets a response for a specific request index.
   */
  setResponse(index: number, response: BatchResponse): void {
    if (index >= 0 && index < this.responses.length) {
      this.responses[index] = response
    } else if (index === this.responses.length) {
      this.responses.push(response)
    }
  }
}
