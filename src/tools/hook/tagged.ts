/**
 * Tagged hook – a proxy hook that filters handler execution by event tags.
 *
 * Ported from PocketBase's tools/hook/tagged.go (MIT license).
 *
 * TaggedHook wraps a [[Hook]] so that handler functions are only invoked
 * when the event's tags match the hook's configured tags. If the
 * TaggedHook has no tags configured, all events are accepted.
 *
 * @example
 * ```ts
 * class CollectionEvent extends Event {
 *   constructor(public readonly collection: string) { super(); }
 *   tags(): string[] { return [this.collection]; }
 * }
 *
 * const base = new Hook<CollectionEvent>();
 * const tagged = new TaggedHook(base, "users");
 *
 * tagged.bindFunc(async (e) => {
 *   console.log("only runs for users:", e.collection);
 *   return e.next();
 * });
 * ```
 */

import type { Handler } from "./hook.ts";
import type { Resolver } from "./event.ts";
import { Hook } from "./hook.ts";

/**
 * Interface for event data that supports tag-based filtering.
 *
 * Events used with [[TaggedHook]] must implement this interface in
 * addition to [[Resolver]].
 */
export interface Tagger extends Resolver {
  /** Returns the list of tags associated with this event. */
  tags(): string[];
}

/**
 * A proxy hook that only invokes its handlers when at least one of the
 * event's tags matches the hook's configured tags.
 *
 * When no tags are configured (`tags` is empty) **all** events are
 * accepted – this mirrors the behaviour of a plain [[Hook]].
 */
export class TaggedHook<T extends Tagger> {
  #hook: Hook<T>;
  #tags: string[];

  /**
   * @param hook  The underlying [[Hook]] that stores the handlers.
   * @param tags  Optional list of tags to filter on.
   */
  constructor(hook: Hook<T>, ...tags: string[]) {
    this.#hook = hook;
    this.#tags = tags;
  }

  /**
   * Returns `true` when this hook can be triggered with the provided
   * event tags.
   *
   * Always returns `true` when the hook has no configured tags (match-all).
   */
  canTriggerOn(tagsToCheck: string[]): boolean {
    if (this.#tags.length === 0) return true; // match all
    return tagsToCheck.some((t) => this.#tags.includes(t));
  }

  /**
   * Registers a handler on the underlying hook.
   *
   * The handler function is wrapped so that it is only invoked if the
   * event's tags satisfy [[canTriggerOn]].
   *
   * Returns the handler id.
   */
  bind(handler: Handler<T>): string {
    const fn = handler.func;
    const wrappedHandler: Handler<T> = {
      ...handler,
      func: async (e: T) => {
        if (this.canTriggerOn(e.tags())) {
          return fn(e);
        }
        return e.next();
      },
    };
    return this.#hook.bind(wrappedHandler);
  }

  /**
   * Convenience wrapper around [[bind]] that creates a handler from a
   * plain function.
   */
  bindFunc(fn: (e: T) => Promise<unknown>): string {
    return this.#hook.bindFunc(async (e: T) => {
      if (this.canTriggerOn(e.tags())) {
        return fn(e);
      }
      return e.next();
    });
  }

  /**
   * Removes one or more handlers by id from the underlying hook.
   */
  unbind(...idsToRemove: string[]): void {
    this.#hook.unbind(...idsToRemove);
  }

  /** Removes all handlers from the underlying hook. */
  unbindAll(): void {
    this.#hook.unbindAll();
  }

  /** Returns the total number of registered handlers. */
  get length(): number {
    return this.#hook.length;
  }

  /**
   * Executes all registered handlers sequentially with the provided event.
   *
   * Optionally accepts one-off handler functions that are temporarily
   * appended to the end of the handler chain.
   */
  async trigger(
    event: T,
    ...oneOffHandlerFuncs: Array<(event: T) => Promise<unknown>>
  ): Promise<unknown> {
    return this.#hook.trigger(event, ...oneOffHandlerFuncs);
  }
}
