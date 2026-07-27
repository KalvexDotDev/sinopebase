/**
 * Event base class and Resolver interface for the hook system.
 *
 * Ported from PocketBase's tools/hook/event.go (MIT license).
 *
 * Every hook event must implement the [[Resolver]] interface. The base
 * [[Event]] class provides the default implementation and is intended to
 * be embedded in custom event types.
 *
 * @example
 * ```ts
 * class MyEvent extends Event {
 *   constructor(public readonly message: string) { super(); }
 * }
 * ```
 */

/**
 * Interface that every hook event must satisfy.
 *
 * - `Next()` proceeds to the next handler in the hook chain.
 * - `nextFunc()` / `setNextFunc()` are internal plumbing for the hook
 *   chain management.
 */
export interface Resolver {
  /** Proceed to the next handler in the hook chain (if any). */
  next(): Promise<unknown>

  /** @internal Returns the current next-function. */
  nextFunc(): (() => Promise<unknown>) | null

  /** @internal Sets the function that [[next]] will call. */
  setNextFunc(fn: (() => Promise<unknown>) | null): void
}

/**
 * Base event class that implements the [[Resolver]] interface.
 *
 * Embed this in your custom event types to make them compatible with
 * [[import("./hook.js").Hook]].
 *
 * @example
 * ```ts
 * class RecordEvent extends Event {
 *   constructor(public readonly recordId: string) { super(); }
 * }
 * ```
 */
export class Event implements Resolver {
  #next: (() => Promise<unknown>) | null = null

  /** Calls the next handler in the chain (or resolves immediately). */
  async next(): Promise<unknown> {
    if (this.#next) {
      return this.#next()
    }
  }

  /** @internal */
  nextFunc(): (() => Promise<unknown>) | null {
    return this.#next
  }

  /** @internal */
  setNextFunc(fn: (() => Promise<unknown>) | null): void {
    this.#next = fn
  }
}
