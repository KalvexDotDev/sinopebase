/**
 * BatchLogHandler buffers log entries and flushes them in batches.
 *
 * Port of PocketBase's tools/logger/batch_handler.go (Go -> TypeScript).
 * Layer 0: zero internal dependencies.
 *
 * Features:
 *   - Configurable batch size threshold for flushing
 *   - Configurable flush interval (timer-based)
 *   - Level filtering (entries below the threshold are dropped)
 *   - BeforeAddFunc for pre-filtering entries
 *   - WriteAll for manual forced flush
 *
 * @example
 *   const handler = new BatchLogHandler({
 *     batchSize: 10,
 *     flushInterval: 5000,
 *     writeFunc: async (logs) => {
 *       for (const entry of logs) {
 *         console.log(entry)
 *       }
 *     },
 *   })
 *
 *   // Uses the Logger interface
 *   handler.Write(LogLevel.Info, "user logged in", { userId: "abc" })
 *
 *   // Force flush
 *   await handler.WriteAll()
 *
 *   // Clean up
 *   handler.dispose()
 */

import type { LogEntry, Logger, LogLevel } from "./log";

// --------------------------------------------------
// Types
// --------------------------------------------------

/**
 * Options for configuring a BatchLogHandler.
 */
export interface BatchLogHandlerOptions {
  /**
   * Callback that processes a batch of log entries.
   *
   * Called when either the batch size threshold is reached
   * or the flush interval timer fires.
   */
  writeFunc: (logs: LogEntry[]) => Promise<void> | void;

  /**
   * Optional function invoked before adding a log entry to the batch queue.
   *
   * Return false to skip adding the entry into the batch queue.
   */
  beforeAddFunc?: ((log: LogEntry) => boolean) | null;

  /**
   * Minimum log level to accept.
   *
   * Entries with a level below this value are discarded immediately.
   * Defaults to LogLevel.Info (0).
   */
  level?: number;

  /**
   * Maximum number of log entries to accumulate before auto-flushing.
   *
   * Defaults to 100 (matching PocketBase's default).
   */
  batchSize?: number;

  /**
   * Interval in milliseconds at which the batch is flushed automatically.
   *
   * Set to 0 to disable timer-based flushing.
   * Defaults to 5000 (5 seconds).
   */
  flushInterval?: number;
}

// --------------------------------------------------
// BatchLogHandler
// --------------------------------------------------

/**
 * BatchLogHandler is a Logger implementation that buffers log entries
 * and flushes them in batches via a user-provided write function.
 *
 * Mirrors PocketBase's BatchHandler (go's slog.Handler wrapper) adapted
 * for the Logger interface defined in this package.
 */
export class BatchLogHandler implements Logger {
  /** The resolved options (with defaults applied). */
  private options: {
    level: number;
    batchSize: number;
    flushInterval: number;
    writeFunc: (logs: LogEntry[]) => Promise<void> | void;
    beforeAddFunc: ((log: LogEntry) => boolean) | null;
  };

  /** Accumulated log entries awaiting a flush. */
  private logs: LogEntry[] = [];

  /** Whether a flush operation is currently in progress. */
  private flushing = false;

  /** Timer handle for interval-based flushing. */
  private timerId: ReturnType<typeof setInterval> | null = null;

  /**
   * Creates a new BatchLogHandler.
   *
   * @param options - Configuration options.
   * @throws If options.writeFunc is not provided.
   */
  constructor(options: BatchLogHandlerOptions) {
    if (!options.writeFunc) {
      throw new Error(
        "[BatchLogHandler] options.writeFunc must be provided",
      );
    }

    this.options = {
      level: options.level ?? 0, // LogLevel.Info
      batchSize: options.batchSize || 100,
      flushInterval: options.flushInterval ?? 5000,
      writeFunc: options.writeFunc,
      beforeAddFunc: options.beforeAddFunc ?? null,
    };

    // Start the timer-based flush if enabled
    if (this.options.flushInterval > 0) {
      this.timerId = setInterval(() => {
        // Fire-and-forget: the promise is handled internally
        this.flush().catch(() => {
          /* flush errors are surfaced via the writeFunc */
        });
      }, this.options.flushInterval);
    }
  }

  // --------------------------------------------------
  // Logger interface
  // --------------------------------------------------

  /**
   * Writes a log entry at the specified level.
   *
   * The entry is added to the internal batch queue.
   * If the queue reaches the batch size threshold, it is automatically flushed.
   *
   * @param level   - The severity level.
   * @param message - The log message.
   * @param data    - Optional structured key-value data.
   */
  Write(
    level: number,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    // Level filtering
    if (level < this.options.level) {
      return;
    }

    const entry: LogEntry = {
      time: new Date(),
      level: level as LogLevel,
      message,
      data,
    };

    // Pre-add filtering
    if (this.options.beforeAddFunc !== null) {
      if (!this.options.beforeAddFunc(entry)) {
        return;
      }
    }

    this.logs.push(entry);

    // Auto-flush if batch size threshold is reached
    if (this.logs.length >= this.options.batchSize) {
      this.flush().catch(() => {
        /* flush errors are surfaced via the writeFunc */
      });
    }
  }

  // --------------------------------------------------
  // Batch-specific methods
  // --------------------------------------------------

  /**
   * Checks whether the handler would accept entries at the given level.
   *
   * @param level - The level to check.
   * @returns true if entries at this level are accepted.
   */
  Enabled(level: number): boolean {
    return level >= this.options.level;
  }

  /**
   * Updates the minimum log level threshold.
   *
   * @param level - The new minimum level.
   */
  SetLevel(level: number): void {
    this.options.level = level;
  }

  /**
   * Forces an immediate flush of all buffered log entries.
   *
   * After this call, the internal queue is emptied and all entries
   * are passed to the writeFunc callback.
   */
  async WriteAll(): Promise<void> {
    await this.flush();
  }

  /**
   * Releases resources held by the handler.
   *
   * Stops the interval timer (if any) and performs a final flush.
   * After calling dispose(), the handler should not be used.
   */
  async dispose(): Promise<void> {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }

    // Final flush
    await this.flush();
  }

  // --------------------------------------------------
  // Internal
  // --------------------------------------------------

  /**
   * Flushes the current batch of log entries to the writeFunc.
   *
   * This method is non-reentrant: if a flush is already in progress,
   * subsequent calls are silently ignored and the entries will be
   * picked up by the next flush.
   */
  private async flush(): Promise<void> {
    if (this.flushing) {
      return;
    }

    if (this.logs.length === 0) {
      return;
    }

    this.flushing = true;

    // Atomically drain the queue
    const batch = this.logs.splice(0);

    try {
      await this.options.writeFunc(batch);
    } finally {
      this.flushing = false;
    }
  }
}
