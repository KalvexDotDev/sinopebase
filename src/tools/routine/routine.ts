/**
 * Async execution helpers.
 *
 * Ported from PocketBase's tools/routine/routine.go (MIT license).
 *
 * Provides FireAndForget for background execution with automatic error
 * handling, and SafeWrap for creating panic-safe function wrappers.
 */

/**
 * Executes `fn` in the background (as a microtask) and catches any
 * synchronous or asynchronous error, logging it to the console.
 *
 * Mirrors Go's `go func()` pattern with deferred recover.
 *
 * @param fn  The function to execute in the background.
 * @param wg  Optional callback invoked when execution completes (similar
 *            to Go's sync.WaitGroup.Done).
 */
export function fireAndForget(fn: () => void | Promise<void>, onDone?: () => void): void {
  queueMicrotask(async () => {
    try {
      await fn();
    } catch (err: unknown) {
      console.error("[FireAndForget] unhandled error:", err);
      if (err instanceof Error && err.stack) {
        console.error(err.stack);
      }
    } finally {
      onDone?.();
    }
  });
}

/**
 * Wraps `fn` so that any thrown exception (or rejected promise) is
 * caught and returned as an `Error` value.
 *
 * Mirrors Go's `SafeWrap` which converts panics into regular errors.
 *
 * @example
 * ```ts
 * const safe = safeWrap(async () => {
 *   if (Math.random() > 0.5) throw new Error("boom");
 *   return "ok";
 * });
 * const err = await safe();
 * if (err) console.error(err);
 * ```
 */
export function safeWrap<T>(fn: () => T | Promise<T>): () => Promise<T | Error> {
  return async (): Promise<T | Error> => {
    try {
      return await fn();
    } catch (err: unknown) {
      if (err instanceof Error) return err;
      return new Error(String(err));
    }
  };
}
