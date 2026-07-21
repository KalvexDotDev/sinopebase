/**
 * Log printer for dev-mode log formatting.
 *
 * Port of PocketBase's core/log_printer.go (Go -> TypeScript).
 *
 * In dev mode, logs are printed directly to the console with
 * colorized formatting for easier reading.
 */

/**
 * Log level names matching slog levels.
 */
export const LogLevelNames: Record<number, string> = {
  [-4]: 'DEBUG',
  [0]: 'INFO',
  [4]: 'WARN',
  [8]: 'ERROR',
}

/**
 * Log level colors for terminal output.
 */
export const LogLevelColors: Record<number, string> = {
  [-4]: '\x1b[36m', // cyan
  [0]: '\x1b[32m', // green
  [4]: '\x1b[33m', // yellow
  [8]: '\x1b[31m', // red
}

const RESET = '\x1b[0m'

/**
 * Pretty-prints a log entry to the console.
 *
 * @param level - The log level number.
 * @param message - The log message.
 * @param data - Optional structured data.
 */
export function printLog(
  level: number,
  message: string,
  data?: Record<string, unknown>,
): void {
  const color = LogLevelColors[level] ?? ''
  const levelName = LogLevelNames[level] ?? 'UNKNOWN'
  const timestamp = new Date().toISOString()

  console.log(
    `${color}[${timestamp}] [${levelName}] ${message}${RESET}`,
    data ?? '',
  )
}
