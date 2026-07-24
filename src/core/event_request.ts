/**
 * RequestEvent and RequestInfo for wrapping HTTP request context.
 *
 * Port of PocketBase's models/request_info.go and tools/rest/request.go
 * (Go -> TypeScript).
 *
 * RequestEvent provides access to the App, Auth info, and parsed request
 * data (method, query, headers, body) for use in hook handlers.
 */

import { Event } from '~/tools/hook/event'

// ---------------------------------------------------------------------------
// RequestInfoContext constants
// ---------------------------------------------------------------------------

/** Default request context. */
export const RequestInfoContextDefault = 'default'

/** Realtime subscription request context. */
export const RequestInfoContextRealtime = 'realtime'

/** Protected file request context. */
export const RequestInfoContextProtectedFile = 'protectedFile'

/** OAuth2 request context. */
export const RequestInfoContextOAuth2 = 'oauth2'

// ---------------------------------------------------------------------------
// RequestInfo
// ---------------------------------------------------------------------------

/**
 * RequestInfo defines a parsed HTTP request data struct.
 *
 * Used as part of the `@request.*` filter resolver and passed to
 * hook handlers for context-aware processing.
 */
export class RequestInfo {
  /** The request context type (default, realtime, protectedFile, oauth2). */
  context: string = RequestInfoContextDefault

  /** URL query parameters as a key-value map. */
  query: Record<string, unknown> = {}

  /** Request body / form data. */
  data: Record<string, unknown> = {}

  /** Request headers as a key-value map. */
  headers: Record<string, unknown> = {}

  /** The authenticated record (if any). */
  authRecord: unknown = null

  /** The authenticated admin (if any). */
  admin: unknown = null

  /** The HTTP method (GET, POST, etc.). */
  method: string = ''

  /**
   * Creates a RequestInfo from an HTTP-like request object.
   *
   * @param request - A partial request object with method, query, headers, body.
   */
  constructor(request?: Partial<RequestInfoInit>) {
    if (request) {
      this.method = request.method ?? ''
      this.query = { ...(request.query ?? {}) }
      this.data = { ...(request.data ?? {}) }
      this.headers = { ...(request.headers ?? {}) }
    }
  }

  /**
   * Loosely checks if the current struct has any modifier Data keys.
   *
   * Modifier keys are schema field value modifiers like "+", "-", etc.
   */
  hasModifierDataKeys(): boolean {
    const allModifiers = ['+', '-', '!', '~']
    for (const key of Object.keys(this.data)) {
      for (const m of allModifiers) {
        if (key.endsWith(m)) {
          return true
        }
      }
    }
    return false
  }
}

/** Initialization shape for creating a RequestInfo. */
export interface RequestInfoInit {
  method: string
  query: Record<string, unknown>
  data: Record<string, unknown>
  headers: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// RequestEvent
// ---------------------------------------------------------------------------

/**
 * RequestEvent wraps an HTTP request context for hook handlers.
 *
 * It provides access to:
 * - The App instance
 * - Auth information (authenticated record/admin)
 * - Parsed request data (RequestInfo)
 */
export class RequestEvent extends Event {
  /** The parsed request information (method, query, headers, body, auth). */
  readonly requestInfo: RequestInfo

  /**
   * Creates a new RequestEvent.
   *
   * @param app - The application instance.
   * @param auth - Authentication information (record or admin).
   * @param requestInfo - Parsed request data.
   */
  /** The application instance. */
  app: unknown
  /** Authentication information. */
  auth: unknown

  constructor(
    /** The application instance. */
    app: unknown,
    /** Authentication information. */
    auth: unknown,
    requestInfo?: RequestInfo | Partial<RequestInfoInit>,
  ) {
    super()
    this.app = app
    this.auth = auth

    if (requestInfo instanceof RequestInfo) {
      this.requestInfo = requestInfo
    } else {
      this.requestInfo = new RequestInfo(requestInfo)
    }
  }
}
