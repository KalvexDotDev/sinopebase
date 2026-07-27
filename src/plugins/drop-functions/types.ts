// ---------------------------------------------------------------------------
// DropFunctions — Edge Function SDK types
// Port of dropfunctions function model for Sinopebase
// ---------------------------------------------------------------------------

/** Standard Web Request passed to function handlers. */
export type FunctionRequest = Request

/** Context available inside every edge function execution. */
export interface FunctionContext {
  /** Unique request identifier */
  requestId: string
  /** The function name (filename without extension) */
  functionName: string
  /** Authenticated user info, or null if auth is not required */
  auth: FunctionAuth | null
  /** Frozen snapshot of environment variables */
  env: Record<string, string>
  /** Structured logger */
  log: (
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    extra?: Record<string, unknown>,
  ) => void
}

/** Authenticated user context passed to edge functions. */
export interface FunctionAuth {
  userId: string
  email: string
  role: string
}

/** Per-function configuration, exported as a named `config` export. */
export interface FunctionConfig {
  /** Require a valid Bearer token (default: false) */
  auth?: boolean
  /** Override the default execution timeout in milliseconds */
  timeout?: number
  /** Per-function rate limiting */
  rateLimit?: {
    requests: number
    window: string // e.g. "1m", "5m", "1h"
  }
}

/** A loaded function module. */
export interface FunctionModule {
  default: FunctionHandler
  config?: FunctionConfig
}

/** Edge function handler signature. */
export type FunctionHandler = (
  req: FunctionRequest,
  ctx: FunctionContext,
) => Promise<Response | Record<string, unknown> | string | undefined>

/** Result from the sandbox worker. */
export interface SandboxResult {
  type: 'result'
  data: unknown
}

/** Error from the sandbox worker. */
export interface SandboxError {
  type: 'error'
  error: string
  stack?: string
}

export type SandboxMessage = SandboxResult | SandboxError
