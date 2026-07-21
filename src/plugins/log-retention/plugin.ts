// ---------------------------------------------------------------------------
// Log Retention Plugin — periodic cleanup + activity logger → DB bridge
// ---------------------------------------------------------------------------

import { Elysia } from 'elysia'
import { BatchLogHandler } from '~/tools/logger/batch_handler'

export interface LogRetentionOptions {
  /** Days to retain logs (default: 30) */
  retentionDays?: number
  /** Flush interval for batch log writes in ms (default: 5000) */
  flushInterval?: number
  /** Batch size before forced flush (default: 100) */
  batchSize?: number
}

export class LogRetentionPlugin {
  private options: Required<LogRetentionOptions>
  private cleanupTimer: ReturnType<typeof setInterval> | null = null
  private batchHandler: BatchLogHandler | null = null

  constructor(options: LogRetentionOptions = {}) {
    this.options = {
      retentionDays: options.retentionDays ?? 30,
      flushInterval: options.flushInterval ?? 5000,
      batchSize: options.batchSize ?? 100,
    }
  }

  async register(app: Elysia, db: any): Promise<void> {
    if (!db) return

    // Bridge activity logger → _logs table using BatchLogHandler
    this.batchHandler = new BatchLogHandler(
      async (entries) => {
        for (const entry of entries) {
          try {
            await db.insert('_logs', {
              id: crypto.randomUUID(),
              level: entry.level,
              message: entry.message,
              data: entry.data ? JSON.stringify(entry.data) : null,
              created: new Date().toISOString(),
            })
          } catch {
            // Log persistence is best-effort
          }
        }
      },
      {
        batchSize: this.options.batchSize,
        flushInterval: this.options.flushInterval,
        minLevel: 0, // Info and above
      },
    )

    // Schedule periodic cleanup of old logs
    const retentionMs = this.options.retentionDays * 24 * 60 * 60 * 1000
    this.cleanupTimer = setInterval(
      async () => {
        try {
          const cutoff = new Date(Date.now() - retentionMs).toISOString()
          await db.delete('_logs', [{ column: 'created', operator: 'lt', value: cutoff }])
        } catch {
          // Best-effort cleanup
        }
      },
      6 * 60 * 60 * 1000, // Every 6 hours
    ).unref()

    // Expose retention config endpoint
    app.get('/api/logs/retention', () => ({
      retentionDays: this.options.retentionDays,
      nextCleanup: this.cleanupTimer ? 'scheduled (every 6h)' : 'disabled',
    }))

    console.log(
      `LogRetention: ${this.options.retentionDays}d retention, flush every ${this.options.flushInterval}ms`,
    )
  }

  /** Trigger an immediate cleanup. */
  async cleanupNow(db: any): Promise<number> {
    if (!db) return 0
    const cutoff = new Date(Date.now() - this.options.retentionDays * 24 * 60 * 60 * 1000)
    const before = await db.count('_logs')
    await db.delete('_logs', [{ column: 'created', operator: 'lt', value: cutoff.toISOString() }])
    const after = await db.count('_logs')
    return before - after
  }

  /** Get the batch log handler for external use. */
  getBatchHandler(): BatchLogHandler | null {
    return this.batchHandler
  }

  /** Stop the cleanup timer. */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
    if (this.batchHandler) {
      this.batchHandler.dispose()
      this.batchHandler = null
    }
  }
}
