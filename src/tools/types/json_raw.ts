/**
 * JSONRaw defines a raw JSON value type that is safe for DB read/write.
 *
 * Port of PocketBase's tools/types/json_raw.go (Go -> TypeScript).
 *
 * Stores raw JSON text as a string, allowing pass-through serialization
 * without double-encoding. This is the TypeScript equivalent of
 * Go's `type JSONRaw []byte` with json.RawMessage semantics.
 */

/**
 * JSONRaw wraps raw JSON text for pass-through serialization.
 *
 * Equivalent to Go's `type JSONRaw []byte` with json.RawMessage behavior.
 *
 * When embedded in another object and serialized with JSON.stringify,
 * the raw JSON text is emitted directly rather than being re-encoded
 * as a string (i.e., it behaves like Go's json.RawMessage).
 *
 * @example
 *   const raw = JSONRaw.ParseJSONRaw('{"a":1,"b":2}')
 *   console.log(raw.String())        // '{"a":1,"b":2}'
 *
 *   // Pass-through in serialization:
 *   const obj = { name: 'test', data: raw }
 *   console.log(JSON.stringify(obj))
 *   // -> '{"name":"test","data":{"a":1,"b":2}}'
 *   // (data is embedded directly, not quoted as a string)
 */
export class JSONRaw {
  /** Internal raw JSON text; null represents empty / unset. */
  private raw: string | null

  /**
   * Create a JSONRaw instance.
   *
   * @param raw - Raw JSON text, or null/undefined for empty/unset.
   */
  constructor(raw?: string | null) {
    this.raw = raw ?? null
  }

  /**
   * Returns the raw JSON text, or null if empty.
   */
  Raw(): string | null {
    return this.raw
  }

  /**
   * Returns the current JSONRaw instance as a JSON-encoded string.
   *
   * An empty (unset) value is serialized as `"null"`.
   *
   * Equivalent to Go's JSONRaw.String() which calls MarshalJSON.
   */
  String(): string {
    if (this.raw === null || this.raw === '') return 'null'
    return this.raw
  }

  /**
   * Called by JSON.stringify to serialize this JSONRaw instance.
   *
   * Returns the parsed JSON value for non-empty raw data, or null for empty.
   *
   * This provides the pass-through behavior: the raw JSON is embedded
   * directly into the parent JSON output without additional quoting.
   *
   * Equivalent to Go's JSONRaw.MarshalJSON() which returns the raw bytes.
   */
  toJSON(): unknown {
    if (this.raw === null || this.raw === '') return null
    try {
      return JSON.parse(this.raw)
    } catch {
      // If the raw data is not valid JSON (edge case), return it as a string
      return this.raw
    }
  }

  /**
   * Replaces the internal data with the provided JSON bytes/text.
   *
   * Equivalent to Go's (*JSONRaw).UnmarshalJSON(b []byte).
   *
   * @param b - The JSON bytes or string to store.
   */
  UnmarshalJSON(b: Uint8Array | string): void {
    if (b instanceof Uint8Array) {
      if (b.length === 0) {
        this.raw = null
      } else {
        this.raw = new TextDecoder().decode(b)
      }
    } else if (typeof b === 'string') {
      this.raw = b || null
    }
  }

  // --------------------------------------------------
  // Static factories
  // --------------------------------------------------

  /**
   * Creates a new JSONRaw instance from the provided value.
   *
   * Equivalent to Go's ParseJSONRaw(value any) (JSONRaw, error).
   *
   * @param value - The value to populate from.
   * @returns A new JSONRaw instance.
   */
  static ParseJSONRaw(value: unknown): JSONRaw {
    const result = new JSONRaw()
    result.Scan(value)
    return result
  }

  /**
   * Populates this JSONRaw from the provided value.
   *
   * Equivalent to Go's (*JSONRaw).Scan(value any).
   *
   * Accepts:
   *   - null / undefined  -> empty state
   *   - string            -> stored as raw JSON text
   *   - Uint8Array        -> decoded as UTF-8 text, then stored
   *   - JSONRaw           -> copies the internal raw text
   *   - other types       -> JSON-stringified then stored
   */
  Scan(value: unknown): void {
    if (value === null || value === undefined) {
      this.raw = null
      return
    }

    if (value instanceof JSONRaw) {
      this.raw = value.raw
      return
    }

    if (value instanceof Uint8Array) {
      if (value.length === 0) {
        this.raw = null
      } else {
        this.raw = new TextDecoder().decode(value)
      }
      return
    }

    if (typeof value === 'string') {
      this.raw = value || null
      return
    }

    // For other types, JSON-serialize them
    const serialized = JSON.stringify(value)
    this.raw = serialized ?? null
  }
}
