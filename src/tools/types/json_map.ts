/**
 * JSONMap defines a map wrapper that is safe for JSON and DB read/write.
 *
 * Port of PocketBase's tools/types/json_map.go (Go -> TypeScript).
 *
 * Wraps a Record<string, T> with JSON and Scan/Value semantics,
 * plus Get/Set accessors for dynamic key access.
 */

/**
 * JSONMap is a generic map wrapper safe for JSON serialization.
 *
 * Equivalent to Go's `type JSONMap[T any] map[string]T`.
 *
 * Provides:
 *   - JSON serialization via toJSON()
 *   - String representation via String()
 *   - Get/Set helpers for dynamic key access
 *   - Scan (populate from various input types)
 *
 * @typeParam T - The type of values stored in the map.
 *
 * @example
 *   const m = new JSONMap<string>({ name: 'test', role: 'admin' })
 *   console.log(m.String())            // '{"name":"test","role":"admin"}'
 *   console.log(m.Get('name'))         // 'test'
 *   m.Set('role', 'user')
 *
 *   const parsed = new JSONMap<number>()
 *   parsed.Scan('{"a":1,"b":2}')
 *   console.log(parsed.Items())        // { a: 1, b: 2 }
 */
export class JSONMap<T> {
  /** Internal map storage. */
  private data: Record<string, T>

  /**
   * Create a JSONMap, optionally initialized with entries.
   *
   * @param initial - Initial key-value pairs.
   */
  constructor(initial?: Record<string, T> | null) {
    this.data = initial ? { ...initial } : {}
  }

  /**
   * Returns the underlying record.
   *
   * Equivalent to accessing the raw map in Go.
   */
  Items(): Record<string, T> {
    return this.data
  }

  /**
   * Returns the number of entries in the map.
   */
  get size(): number {
    return Object.keys(this.data).length
  }

  /**
   * Returns the keys of the map.
   */
  Keys(): string[] {
    return Object.keys(this.data)
  }

  /**
   * Retrieves a single value from the map.
   *
   * Equivalent to Go's JSONMap.Get(key).
   *
   * @param key - The key to look up.
   * @returns The value, or undefined if the key does not exist.
   */
  Get(key: string): T | undefined {
    return this.data[key]
  }

  /**
   * Sets a single value in the map.
   *
   * Equivalent to Go's JSONMap.Set(key, value).
   *
   * @param key   - The key to set.
   * @param value - The value to assign.
   */
  Set(key: string, value: T): void {
    this.data[key] = value
  }

  /**
   * Checks if a key exists in the map.
   *
   * @param key - The key to check.
   */
  Has(key: string): boolean {
    return key in this.data
  }

  /**
   * Deletes a key from the map.
   *
   * @param key - The key to delete.
   * @returns true if the key existed and was deleted.
   */
  Delete(key: string): boolean {
    if (key in this.data) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete this.data[key]
      return true
    }
    return false
  }

  /**
   * Serializes the current JSONMap into a JSON string.
   *
   * An empty (nil-like) map is serialized as `{}`.
   *
   * Equivalent to Go's JSONMap.String().
   */
  String(): string {
    return JSON.stringify(this.data)
  }

  /**
   * Called by JSON.stringify to serialize this JSONMap.
   *
   * An empty/null map is serialized as `{}` (same as Go's MarshalJSON
   * which initializes an empty map if nil).
   */
  toJSON(): Record<string, T> {
    return this.data
  }

  // --------------------------------------------------
  // Static factories
  // --------------------------------------------------

  /**
   * Creates a new JSONMap from the provided value.
   *
   * @param value - The value to populate from.
   * @returns A new JSONMap instance.
   */
  static From<T>(value: unknown): JSONMap<T> {
    const m = new JSONMap<T>()
    m.Scan(value)
    return m
  }

  /**
   * Populates this JSONMap from the provided value.
   *
   * Equivalent to Go's (*JSONMap[T]).Scan(value any).
   *
   * Accepts:
   *   - null / undefined              -> initializes as empty map
   *   - Record<string, T> (object)    -> copies entries
   *   - JSONMap<T>                    -> copies entries
   *   - string                        -> parses as JSON object
   *   - Uint8Array                    -> decodes as UTF-8 text, then parses as JSON
   *   - other types                   -> throws (Scan expects a map-like value)
   */
  Scan(value: unknown): void {
    if (value === null || value === undefined) {
      this.data = {}
      return
    }

    if (value instanceof JSONMap) {
      this.data = { ...value.data }
      return
    }

    if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Uint8Array)) {
      this.data = { ...(value as Record<string, T>) }
      return
    }

    if (typeof value === 'string') {
      if (value === '') {
        this.data = {}
        return
      }
      const parsed = JSON.parse(value)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        this.data = parsed as Record<string, T>
      } else {
        throw new Error(
          `[JSONMap] failed to unmarshal value: expected JSON object, got ${typeof parsed}`,
        )
      }
      return
    }

    if (value instanceof Uint8Array) {
      if (value.length === 0) {
        this.data = {}
        return
      }
      const text = new TextDecoder().decode(value)
      this.Scan(text)
      return
    }

    throw new Error(`[JSONMap] failed to unmarshal value: ${JSON.stringify(value)}`)
  }
}
