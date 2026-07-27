/**
 * Generic hook system for event-driven extensibility.
 *
 * Ported from PocketBase's tools/hook/hook.go (MIT license).
 *
 * Hook is PocketBase's primary extensibility primitive. Handlers are
 * registered with [[Hook.bind]] or [[Hook.bindFunc]], ordered by
 * priority, and executed sequentially when [[Hook.trigger]] is called.
 * Each handler must call `event.next()` to pass control to the next
 * handler in the chain.
 *
 * @example
 * ```ts
 * class MyEvent extends Event {
 *   constructor(public readonly message: string) { super(); }
 * }
 *
 * const h = new Hook<MyEvent>();
 * h.bindFunc(async (e) => {
 *   console.log("handler 1:", e.message);
 *   return e.next();
 * });
 * h.bindFunc(async (e) => {
 *   console.log("handler 2:", e.message);
 *   return e.next();
 * });
 * await h.trigger(new MyEvent("hello"));
 * ```
 */

import type { Resolver } from './event.ts'
import { Event } from './event.ts'

export type { Resolver }

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * A single hook handler.
 *
 * Multiple handlers may share the same `id`. If `id` is omitted it will
 * be auto-generated when the handler is bound to a hook.
 */
export interface Handler<T extends Resolver> {
  /** The handler function to execute. */
  func: (event: T) => Promise<unknown>

  /**
   * Unique identifier. Used to later remove the handler via
   * [[Hook.unbind]]. Auto-generated if empty.
   */
  id: string

  /**
   * Execution priority. Lower values execute first. Handlers with the
   * same priority preserve their registration order.
   */
  priority: number
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

/** Generate a random 20-character hook handler ID. */
function generateHookId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < 20; i++) {
    result += chars[Math.floor(Math.random() * chars.length)]
  }
  return result
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Generic concurrent-safe hook for managing event handler chains.
 *
 * Handlers are executed in priority order (ascending). Each handler
 * **must** call `event.next()` to proceed to the next handler.
 *
 * Custom event types must implement the [[Resolver]] interface (the base
 * [[Event]] class provides a default implementation).
 */
export class Hook<T extends Resolver> {
  #handlers: Handler<T>[] = []

  /**
   * Registers a handler on this hook.
   *
   * If `handler.id` is empty it is auto-generated.
   * If a handler with the same `id` already exists it is **replaced**.
   *
   * Returns the handler id.
   */
  bind(handler: Handler<T>): string {
    const idx = handler.id === '' ? -1 : this.#handlers.findIndex((h) => h.id === handler.id)

    if (idx !== -1) {
      // Replace existing
      this.#handlers[idx] = handler
    } else {
      // Auto-generate id and ensure uniqueness
      if (handler.id === '') {
        let id: string
        do {
          id = generateHookId()
        } while (this.#handlers.some((h) => h.id === id))
        handler = { ...handler, id }
      }
      this.#handlers.push(handler)
    }

    // Stable sort by priority (ascending)
    this.#handlers.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority
      return 0 // stable – preserve original order
    })

    return handler.id
  }

  /**
   * Convenience wrapper around [[bind]] that creates a handler with
   * auto-generated id and default priority (0).
   */
  bindFunc(fn: (event: T) => Promise<unknown>): string {
    return this.bind({ func: fn, id: '', priority: 0 })
  }

  /**
   * Removes one or more handlers by id.
   */
  unbind(...idsToRemove: string[]): void {
    const ids = new Set(idsToRemove)
    this.#handlers = this.#handlers.filter((h) => !ids.has(h.id))
  }

  /** Removes all registered handlers. */
  unbindAll(): void {
    this.#handlers = []
  }

  /** Returns the total number of registered handlers. */
  get length(): number {
    return this.#handlers.length
  }

  /**
   * Executes all registered handlers sequentially with the provided event.
   *
   * Optionally accepts one-off handler functions that are temporarily
   * appended to the end of the handler chain.
   *
   * Each handler **must** call `event.next()` for the chain to proceed.
   */
  async trigger(
    event: T,
    ...oneOffHandlerFuncs: Array<(event: T) => Promise<unknown>>
  ): Promise<unknown> {
    const allHandlers: Array<(event: T) => Promise<unknown>> = [
      ...this.#handlers.map((h) => h.func),
      ...oneOffHandlerFuncs,
    ]

    // Reset the next chain in case the event is being reused.
    event.setNextFunc(null)

    // Build the chain from tail to head.
    for (let i = allHandlers.length - 1; i >= 0; i--) {
      const handlerFn = allHandlers[i]
      if (handlerFn === undefined) continue
      const oldNext = event.nextFunc()
      event.setNextFunc(() => {
        event.setNextFunc(oldNext)
        return handlerFn(event)
      })
    }

    return event.next()
  }
}

export { Event }
