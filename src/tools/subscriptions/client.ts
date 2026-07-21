/**
 * Subscription client interface and default implementation.
 *
 * Port of PocketBase tools/subscriptions/client.go (MIT license).
 * Layer 1 -- imports Layer 0 (~/tools/...).
 */

import { PseudorandomString } from "~/tools/security/random";
import { Snakecase } from "~/tools/inflector/inflector";
import type { Message } from "./message";

/**
 * Options associated with a single subscription topic.
 */
export interface SubscriptionOptions {
  query: Record<string, string>;
  headers: Record<string, string>;
}

/**
 * Client is the interface for a generic subscription client.
 */
export interface Client {
  /** Returns the unique id of the client. */
  id(): string;

  /**
   * Returns a shallow copy of the client subscriptions matching the prefixes.
   * If no prefix is specified, returns all subscriptions.
   */
  subscriptions(...prefixes: string[]): Record<string, SubscriptionOptions>;

  /**
   * Subscribes the client to the provided subscriptions list.
   *
   * Each subscription can also have "options" (JSON serialized SubscriptionOptions)
   * as query parameter.
   *
   * @example
   *   client.subscribe("subscriptionA");
   *   client.subscribe(`subscriptionB?options={"query":{"a":1},"headers":{"x_token":"abc"}}`);
   */
  subscribe(...subs: string[]): void;

  /**
   * Unsubscribes the client from the provided subscriptions list.
   * If no subscriptions are specified, removes all.
   */
  unsubscribe(...subs: string[]): void;

  /** Checks if the client is subscribed to `sub`. */
  hasSubscription(sub: string): boolean;

  /** Stores any value in the client's context. */
  set(key: string, value: unknown): void;

  /** Removes a single value from the client's context. */
  unset(key: string): void;

  /** Retrieves a key value from the client's context. */
  get(key: string): unknown;

  /**
   * Marks the client as "discarded", meaning that it should not be used
   * anymore for sending new messages. It is safe to call multiple times.
   */
  discard(): void;

  /** Indicates whether the client has been "discarded". */
  isDiscarded(): boolean;

  /**
   * Sends the specified message to this client (if not discarded).
   *
   * Implementations should deliver the message via their transport
   * (e.g. WebSocket send, callback invocation, or queue push).
   */
  send(m: Message): void;
}

/**
 * Callback-based subscription client.
 *
 * The simplest DefaultClient that invokes a callback when a message is sent.
 * Useful when the caller already manages the transport (e.g. Elysia WS).
 */
export class DefaultClient implements Client {
  readonly #id: string;
  readonly #store = new Map<string, unknown>();
  readonly #subscriptions = new Map<string, SubscriptionOptions>();
  #isDiscarded = false;

  /**
   * Optional message callback invoked when `send()` is called.
   * Set this externally to wire up delivery (e.g. `client.onMessage = (m) => ws.send(...)`).
   */
  onMessage: ((msg: Message) => void) | null = null;

  constructor(id?: string) {
    this.#id = id ?? PseudorandomString(40);
  }

  // -----------------------------------------------------------------------
  // Accessors
  // -----------------------------------------------------------------------

  id(): string {
    return this.#id;
  }

  // -----------------------------------------------------------------------
  // Subscriptions
  // -----------------------------------------------------------------------

  subscriptions(...prefixes: string[]): Record<string, SubscriptionOptions> {
    const result: Record<string, SubscriptionOptions> = {};

    if (prefixes.length === 0) {
      for (const [sub, opts] of this.#subscriptions) {
        result[sub] = { ...opts };
      }
      return result;
    }

    for (const prefix of prefixes) {
      for (const [sub, opts] of this.#subscriptions) {
        // "?" appended to sub ensures the options query start character is always
        // present so it can be used as an end separator when checking only the
        // main subscription topic
        if ((sub + "?").startsWith(prefix)) {
          result[sub] = { ...opts };
        }
      }
    }
    return result;
  }

  subscribe(...subs: string[]): void {
    for (const s of subs) {
      if (s === "") continue;

      let query: Record<string, string> = {};
      let headers: Record<string, string> = {};

      const qMarkIdx = s.indexOf("?");
      if (qMarkIdx !== -1) {
        const qs = s.slice(qMarkIdx + 1);
        const params = new URLSearchParams(qs);
        const rawOptions = params.get("options");
        if (rawOptions) {
          try {
            const parsed = JSON.parse(rawOptions) as {
              query?: Record<string, unknown>;
              headers?: Record<string, unknown>;
            };
            if (parsed.query) {
              for (const [k, v] of Object.entries(parsed.query)) {
                query[k] = String(v ?? "");
              }
            }
            if (parsed.headers) {
              for (const [k, v] of Object.entries(parsed.headers)) {
                // Normalize header names: "X-Token" -> "x_token"
                headers[Snakecase(k)] = String(v ?? "");
              }
            }
          } catch {
            // Ignore invalid JSON options
          }
        }
      }

      this.#subscriptions.set(s, { query, headers });
    }
  }

  unsubscribe(...subs: string[]): void {
    if (subs.length > 0) {
      for (const s of subs) {
        this.#subscriptions.delete(s);
      }
    } else {
      this.#subscriptions.clear();
    }
  }

  hasSubscription(sub: string): boolean {
    return this.#subscriptions.has(sub);
  }

  // -----------------------------------------------------------------------
  // Context store
  // -----------------------------------------------------------------------

  get(key: string): unknown {
    return this.#store.get(key);
  }

  set(key: string, value: unknown): void {
    this.#store.set(key, value);
  }

  unset(key: string): void {
    this.#store.delete(key);
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  discard(): void {
    this.#isDiscarded = true;
    this.onMessage = null;
  }

  isDiscarded(): boolean {
    return this.#isDiscarded;
  }

  // -----------------------------------------------------------------------
  // Send
  // -----------------------------------------------------------------------

  send(m: Message): void {
    if (this.#isDiscarded) return;

    try {
      this.onMessage?.(m);
    } catch {
      // Gracefully handle errors during delivery
    }
  }
}
