/**
 * Structured JSON Logger for Sinopebase.
 *
 * Provides leveled logging with structured output:
 * - Production (NODE_ENV=production): JSON lines to stdout/stderr
 * - Development: Pretty-print with colors
 * - Secret redaction: filters values matching /secret|key|token|password|authorization/i
 * - Request ID generation and propagation via AsyncLocalStorage
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

// ---------------------------------------------------------------------------
// Log levels
// ---------------------------------------------------------------------------

export const LogLevel = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
} as const

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel]

// ---------------------------------------------------------------------------
// LogEntry interface
// ---------------------------------------------------------------------------

export interface LogEntry {
  level: LogLevel
  msg: string
  ts: string
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Secret redaction
// ---------------------------------------------------------------------------

const SECRET_PATTERN = /secret|key|token|password|authorization/i

/**
 * Deep-clone a context object, replacing values whose keys match
 * SECRET_PATTERN with `'[REDACTED]'`.
 */
function redact(ctx: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(ctx)) {
    if (SECRET_PATTERN.test(k)) {
      result[k] = '[REDACTED]'
    } else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      result[k] = redact(v as Record<string, unknown>)
    } else {
      result[k] = v
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Pretty-print colors
// ---------------------------------------------------------------------------

const COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m',   // cyan
  info: '\x1b[32m',    // green
  warn: '\x1b[33m',    // yellow
  error: '\x1b[31m',   // red
}
const RESET = '\x1b[0m'
const DIM = '\x1b[2m'

// ---------------------------------------------------------------------------
// Mode detection
// ---------------------------------------------------------------------------

function isProduction(): boolean {
  return process.env['NODE_ENV'] === 'production'
}

// ---------------------------------------------------------------------------
// AsyncLocalStorage for request-scoped context
// ---------------------------------------------------------------------------

const requestStorage = new AsyncLocalStorage<Record<string, unknown>>()

/**
 * Run a function within a request-scoped context.
 * The context is automatically merged into every log entry emitted
 * while the function executes.
 */
export function withRequestContext<T>(
  ctx: Record<string, unknown>,
  fn: () => T,
): T {
  return requestStorage.run(ctx, fn)
}

/**
 * Get the current request-scoped context (if any).
 */
function getRequestContext(): Record<string, unknown> {
  return requestStorage.getStore() ?? {}
}

// ---------------------------------------------------------------------------
// Request ID helpers
// ---------------------------------------------------------------------------

/**
 * Generate a new request ID (UUID v4).
 */
export function generateRequestId(): string {
  return randomUUID()
}

/**
 * Run an async function within a request scope that includes a request_id.
 */
export function withRequestId<T>(requestId: string, fn: () => T): T {
  return withRequestContext({ request_id: requestId }, fn)
}

// ---------------------------------------------------------------------------
// Logger implementation
// ---------------------------------------------------------------------------

function writeEntry(level: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
  const entry: LogEntry = {
    level,
    msg,
    ts: new Date().toISOString(),
    ...getRequestContext(),
    ...(ctx ?? {}),
  }

  // Redact secrets from the entry for output, keeping original ctx intact
  // (the caller's ctx object is never mutated).
  const safe = redact(entry)

  if (isProduction()) {
    // JSON lines to stdout (info/debug) or stderr (warn/error)
    const line = JSON.stringify(safe) + '\n'
    const dest = level === 'warn' || level === 'error' ? process.stderr : process.stdout
    dest.write(line)
  } else {
    // Pretty-print with colors
    const color = COLORS[level] ?? ''
    const label = level.toUpperCase().padEnd(5)
    const timestamp = safe['ts'] as string

    // Build clean output: only show context keys that are not the built-in fields
    const rest: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(safe)) {
      if (k !== 'level' && k !== 'msg' && k !== 'ts') rest[k] = v
    }
    const extra = Object.keys(rest).length > 0
      ? ` ${DIM}${JSON.stringify(rest)}${RESET}`
      : ''

    const dest = level === 'error' ? process.stderr : process.stdout
    dest.write(`${color}[${timestamp}] [${label}] ${msg}${RESET}${extra}\n`)
  }
}

export const logger = {
  debug(msg: string, ctx?: Record<string, unknown>): void {
    writeEntry(LogLevel.DEBUG, msg, ctx)
  },

  info(msg: string, ctx?: Record<string, unknown>): void {
    writeEntry(LogLevel.INFO, msg, ctx)
  },

  warn(msg: string, ctx?: Record<string, unknown>): void {
    writeEntry(LogLevel.WARN, msg, ctx)
  },

  error(msg: string, ctx?: Record<string, unknown>): void {
    writeEntry(LogLevel.ERROR, msg, ctx)
  },
}
