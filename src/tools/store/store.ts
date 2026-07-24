/**
 * Generic thread-safe in-memory key-value data store.
 *
 * Ported from PocketBase's tools/store/store.go (MIT license).
 *
 * The store wraps a standard Map with a simple async lock to provide
 * concurrent-safe access in asynchronous contexts.
 *
 * @example
 * ```ts
 * const s = new Store<string, number>();
 * s.set("count", 1);
 * s.setFunc("count", (old) => old + 1);
 * console.log(s.get("count")); // 2
 * ```
 */

// ---------------------------------------------------------------------------
// Lock
// ---------------------------------------------------------------------------

/**
 * Minimal non-reentrant promise-based lock.
 * Used to mirror the Go sync.RWMutex semantics for async-safe access.
 */
class Lock {
  #locked = false;
  #queue: Array<() => void> = [];

  async acquire(): Promise<void> {
    if (!this.#locked) {
      this.#locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.#queue.push(() => {
        this.#locked = true;
        resolve();
      });
    });
  }

  release(): void {
    if (this.#queue.length > 0) {
      const next = this.#queue.shift()!;
      next();
    } else {
      this.#locked = false;
    }
  }

  get isLocked(): boolean {
    return this.#locked;
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * Thread-safe in-memory key-value store.
 * Generic over key type K and value type V.
 */
export class Store<K, V> {
  #data: Map<K, V>;
  #lock = new Lock();
  #deleted = 0;

  /**
   * Creates a new Store, optionally initialised with a shallow copy of the
   * provided entries.
   */
  constructor(entries?: ReadonlyMap<K, V> | Readonly<Record<string & K, V>> | null) {
    this.#data = new Map<K, V>();

    if (entries) {
      if (entries instanceof Map) {
        for (const [k, v] of entries) {
          this.#data.set(k, v);
        }
      } else {
        for (const k of Object.keys(entries as Record<string, V>)) {
          this.#data.set(k as unknown as K, (entries as Record<string, V>)[k] as V);
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /** @internal true when the shrink threshold has been reached. */
  static readonly #SHRINK_THRESHOLD = 200;

  /** @internal Re-allocate the underlying map to let the old one be GC'd. */
  #maybeShrink(): void {
    this.#deleted++;
    if (this.#deleted < Store.#SHRINK_THRESHOLD) return;
    this.#data = new Map(this.#data);
    this.#deleted = 0;
  }

  // -----------------------------------------------------------------------
  // Mutex helpers – public so callers can batch work safely.
  // -----------------------------------------------------------------------

  /** Acquire the exclusive write lock. */
  async lock(): Promise<void> {
    return this.#lock.acquire();
  }

  /** Release the exclusive write lock. */
  unlock(): void {
    this.#lock.release();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Clears the store and replaces entries with a shallow copy of the
   * provided data (if any).
   */
  reset(newData?: ReadonlyMap<K, V> | Readonly<Record<string & K, V>> | null): void {
    this.#data = new Map<K, V>();
    if (newData) {
      if (newData instanceof Map) {
        for (const [k, v] of newData) {
          this.#data.set(k, v);
        }
      } else {
        for (const k of Object.keys(newData as Record<string, V>)) {
          this.#data.set(k as unknown as K, (newData as Record<string, V>)[k] as V);
        }
      }
    }
    this.#deleted = 0;
  }

  /** Returns the number of entries currently in the store. */
  get length(): number {
    return this.#data.size;
  }

  /** Removes all entries from the store. */
  removeAll(): void {
    this.reset();
  }

  /**
   * Removes a single entry. Does nothing if the key does not exist.
   * Periodically re-allocates the internal map to allow GC of old storage
   * (mirrors the Go ShrinkThreshold behaviour).
   */
  remove(key: K): void {
    if (!this.#data.has(key)) return;
    this.#data.delete(key);
    this.#maybeShrink();
  }

  /** Returns `true` when an entry for `key` exists. */
  has(key: K): boolean {
    return this.#data.has(key);
  }

  /**
   * Returns the value for `key`, or `undefined` when the key does not
   * exist.
   */
  get(key: K): V | undefined {
    return this.#data.get(key);
  }

  /**
   * Similar to [[get]] but also returns a boolean indicating whether the
   * key exists.
   */
  getOk(key: K): { value: V; ok: true } | { value: undefined; ok: false } {
    const v = this.#data.get(key);
    if (v !== undefined || this.#data.has(key)) {
      return { value: v as V, ok: true };
    }
    return { value: undefined, ok: false };
  }

  /**
   * Returns a shallow copy of all entries as a plain object.
   * Note: key type K is coerced to `string` for the object representation.
   */
  getAll(): Map<K, V> {
    return new Map(this.#data);
  }

  /** Returns an array of all values currently in the store. */
  values(): V[] {
    return [...this.#data.values()];
  }

  /**
   * Sets (or overwrites) a value for `key`.
   */
  set(key: K, value: V): void {
    this.#data.set(key, value);
  }

  /**
   * Similar to [[set]], but the value is resolved from a callback that
   * receives the old value (or `undefined` if the key did not exist).
   *
   * @example
   * ```ts
   * store.setFunc("count", (old) => (old ?? 0) + 1);
   * ```
   */
  setFunc(key: K, fn: (old: V | undefined) => V): void {
    this.#data.set(key, fn(this.#data.get(key)));
  }

  /**
   * Atomically retrieves the value for `key` or, if it does not exist,
   * calls `setFunc` and stores the result.
   *
   * Uses a double-checked locking pattern (read lock → write lock) to
   * minimise contention.
   */
  async getOrSet(key: K, setFunc: () => V | Promise<V>): Promise<V> {
    // Fast path – read without lock.
    const existing = this.#data.get(key);
    if (existing !== undefined || this.#data.has(key)) {
      return existing as V;
    }

    // Slow path – acquire the write lock and double-check.
    await this.#lock.acquire();
    try {
      const dup = this.#data.get(key);
      if (dup !== undefined || this.#data.has(key)) {
        return dup as V;
      }
      const value = await setFunc();
      this.#data.set(key, value);
      return value;
    } finally {
      this.#lock.release();
    }
  }

  /**
   * Similar to [[set]] but **skips adding new elements** if the store has
   * reached `maxAllowedElements`. Returns `false` when the limit prevents
   * the insertion.
   *
   * Overwriting an existing key is always allowed regardless of the limit.
   */
  setIfLessThanLimit(key: K, value: V, maxAllowedElements: number): boolean {
    if (this.#data.has(key)) {
      this.#data.set(key, value);
      return true;
    }
    if (this.#data.size >= maxAllowedElements) {
      return false;
    }
    this.#data.set(key, value);
    return true;
  }

  // -----------------------------------------------------------------------
  // JSON serialisation
  // -----------------------------------------------------------------------

  /**
   * Imports JSON data into the store. Existing entries with matching keys
   * are overwritten.
   */
  importJSON(json: string): void {
    const raw = JSON.parse(json) as Record<string, V>;
    for (const k of Object.keys(raw)) {
      this.#data.set(k as unknown as K, raw[k] as V);
    }
  }

  /**
   * Exports the store data as a JSON string.
   */
  exportJSON(): string {
    const obj: Record<string, V> = {};
    for (const [k, v] of this.#data) {
      obj[String(k)] = v;
    }
    return JSON.stringify(obj);
  }
}
