/**
 * API error type aliases for PocketBase-compatible error handling.
 *
 * Port of PocketBase apis/api_error_aliases.go
 * Layer 4 — imports from ~/core/*, ~/tools/*.
 *
 * Each error class carries a numeric HTTP status and optional raw data
 * payload so route handlers can throw a structured error that the
 * response serializer converts to the standard PocketBase shape:
 *
 *   { "code": <status>, "message": "...", "data": {...} }
 */

// ---------------------------------------------------------------------------
// ApiError — base class
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  status: number
  data?: unknown

  /**
   * @param status   HTTP status code (401, 403, 404, 500, …)
   * @param message  Human-readable message shown to the caller.
   * @param data     Optional structured details (validation errors, etc.).
   */
  constructor(status: number, message: string, data?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }

  /** Serialise to the PocketBase wire format. PostgREST error codes are strings. */
  toJSON(): Record<string, unknown> {
    return {
      code: String(this.status),
      message: this.message,
      data: this.data ?? null,
    }
  }
}

// ---------------------------------------------------------------------------
// Concrete error types
// ---------------------------------------------------------------------------

export class BadRequestError extends ApiError {
  constructor(message = 'Bad request.', data?: unknown) {
    super(400, message, data)
    this.name = 'BadRequestError'
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = 'Unauthorized.', data?: unknown) {
    super(401, message, data)
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = 'Forbidden.', data?: unknown) {
    super(403, message, data)
    this.name = 'ForbiddenError'
  }
}

export class NotFoundError extends ApiError {
  constructor(message = 'Not found.', data?: unknown) {
    super(404, message, data)
    this.name = 'NotFoundError'
  }
}

export class TooManyRequestsError extends ApiError {
  constructor(message = 'Too many requests.', data?: unknown) {
    super(429, message, data)
    this.name = 'TooManyRequestsError'
  }
}

export class InternalServerError extends ApiError {
  constructor(message = 'Internal server error.', data?: unknown) {
    super(500, message, data)
    this.name = 'InternalServerError'
  }
}

export class RequestEntityTooLargeError extends ApiError {
  constructor(message = 'Request entity too large.', data?: unknown) {
    super(413, message, data)
    this.name = 'RequestEntityTooLargeError'
  }
}

// ---------------------------------------------------------------------------
// Helper — wrap any Error into an ApiError
// ---------------------------------------------------------------------------

/**
 * Wraps an arbitrary Error into an [[ApiError]] (if not already one).
 * If the error is already an ApiError it is returned as-is.
 */
export function toApiError(err: Error): ApiError {
  if (err instanceof ApiError) return err
  return new InternalServerError(err.message, { cause: err.stack ?? '' })
}
