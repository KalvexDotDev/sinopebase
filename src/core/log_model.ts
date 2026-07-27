/**
 * Log model for application logging.
 *
 * Port of PocketBase's models/log.go (Go -> TypeScript).
 */

import type { DateTime } from '~/tools/types/datetime'
import { BaseModel } from './db_model'

/**
 * Log represents a single application log entry.
 */
export class Log extends BaseModel {
  /** The log level (debug=4, info=0, warn=4, error=8). */
  level = 0

  /** The log message. */
  message = ''

  /** Additional structured log data. */
  data: Record<string, unknown> = {}

  override tableName(): string {
    return '_logs'
  }
}

/**
 * LogsStatsItem represents hourly grouped log statistics.
 */
export interface LogsStatsItem {
  /** The date/timestamp for the stats bucket. */
  date: DateTime

  /** The log count for this bucket. */
  count: number
}
