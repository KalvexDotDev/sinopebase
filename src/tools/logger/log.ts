/**
 * Structured logging utilities.
 *
 * Port of PocketBase's tools/logger package (Go -> TypeScript).
 * Layer 0: zero internal dependencies.
 *
 * Provides:
 *   - LogLevel constants (Debug, Info, Warn, Error)
 *   - LogEntry interface
 *   - Logger interface with Write(level, message, data)
 *   - ConsoleLogger implementation
 *
 * @example
 *   const log = new ConsoleLogger()
 *   log.Write(LogLevel.Info, "server started", { port: 8080 })
 *   // 2024-01-15T10:30:00.000Z [INFO] server started {"port":8080}
 *
 *   log.Write(LogLevel.Error, "connection failed", { err: "timeout" })
 *   // 2024-01-15T10:30:01.000Z [ERROR] connection failed {"err":"timeout"}
 */

// --------------------------------------------------
// LogLevel
// --------------------------------------------------

/**
 * Log level constants.
 *
 * Mirrors Go's slog.Level with Debug=-4, Info=0, Warn=4, Error=8.
 */
export const LogLevel = {
  /** Debug level (lowest severity). */
  Debug: -4,
  /** Info level (normal operational messages). */
  Info: 0,
  /** Warn level (potentially harmful situations). */
  Warn: 4,
  /** Error level (error events that might still allow the app to continue). */
  Error: 8,
} as const

/** Numeric LogLevel type. */
export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel]

/** Human-readable label for each log level. */
const LogLevelLabel: Record<number, string> = {
  [LogLevel.Debug]: 'DEBUG',
  [LogLevel.Info]: 'INFO',
  [LogLevel.Warn]: 'WARN',
  [LogLevel.Error]: 'ERROR',
}

// --------------------------------------------------
// Types
// --------------------------------------------------

/**
 * A single log entry.
 *
 * Mirrors PocketBase's logger.Log struct.
 */
export interface LogEntry {
  /** Timestamp of the log event. */
  time: Date
  /** Log severity level. */
  level: LogLevel
  /** Log message. */
  message: string
  /** Optional structured data associated with the log entry. */
  data?: Record<string, unknown>
}

// --------------------------------------------------
// Logger interface
// --------------------------------------------------

/**
 * Logger defines the interface for structured logging.
 *
 * Mirrors the pattern of Go's slog.Handler with a simplified Write method.
 */
export interface Logger {
  /**
   * Writes a log entry at the specified level.
   *
   * @param level   - The severity level.
   * @param message - The log message.
   * @param data    - Optional structured key-value data.
   */
  Write(level: LogLevel, message: string, data?: Record<string, unknown>): void
}

// --------------------------------------------------
// ConsoleLogger
// --------------------------------------------------

/**
 * ConsoleLogger writes structured log entries to the console (stdout/stderr).
 *
 * Format: `<ISO timestamp> [LEVEL] message {json data}`
 *
 * - Debug and Info are written to stdout.
 * - Warn and Error are written to stderr.
 *
 * Implements the Logger interface.
 */
export class ConsoleLogger implements Logger {
  /**
   * Writes a structured log entry to the console.
   *
   * @param level   - The severity level.
   * @param message - The log message.
   * @param data    - Optional structured key-value data.
   */
  Write(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    const timestamp = new Date().toISOString()
    const label = LogLevelLabel[level] ?? 'UNKNOWN'
    const dataStr = data !== undefined ? ` ${JSON.stringify(data)}` : ''
    const line = `${timestamp} [${label}] ${message}${dataStr}`

    if (level >= LogLevel.Warn) {
      console.error(line)
    } else {
      console.log(line)
    }
  }
}
