/**
 * JSONArray defines an array wrapper that is safe for JSON and DB read/write.
 *
 * Port of PocketBase's tools/types/json_array.go (Go -> TypeScript).
 *
 * Wraps a plain Array<T> with JSON and Scan/Value semantics.
 */

/**
 * JSONArray is a generic array wrapper safe for JSON serialization.
 *
 * Equivalent to Go's `type JSONArray[T any] []T`.
 *
 * Provides:
 *   - JSON serialization via toJSON()
 *   - String representation via String()
 *   - Scan (populate from various input types)
 *   - Standard array access via items() and the underlying array
 *
 * @typeParam T - The type of elements stored in the array.
 *
 * @example
 *   const arr = new JSONArray<number>([1, 2, 3])
 *   console.log(arr.String())        // "[1,2,3]"
 *   console.log(JSON.stringify(arr)) // "[1,2,3]"
 *
 *   const parsed = new JSONArray<number>()
 *   parsed.Scan('[4,5,6]')
 *   console.log(parsed.items())      // [4, 5, 6]
 */
export class JSONArray<T> {
  /** Internal array storage. */
  private items: T[]

  /**
   * Create a JSONArray, optionally initialized with values.
   *
   * @param initial - Initial values for the array.
   */
  constructor(initial?: T[] | null) {
    this.items = initial ?? []
  }

  /**
   * Returns the underlying array.
   *
   * Equivalent to accessing the raw slice in Go.
   */
  Items(): T[] {
    return this.items
  }

  /**
   * Returns the number of elements in the array.
   */
  get length(): number {
    return this.items.length
  }

  /**
   * Returns the element at the given index, or undefined if out of bounds.
   *
   * @param index - The zero-based index.
   */
  At(index: number): T | undefined {
    return this.items[index]
  }

  /**
   * Adds one or more elements to the end of the array.
   *
   * @param values - Values to append.
   * @returns The new length of the array.
   */
  Push(...values: T[]): number {
    return this.items.push(...values)
  }

  /**
   * Serializes the current JSONArray into a JSON string.
   *
   * An empty (nil-like) array is serialized as `[]`.
   *
   * Equivalent to Go's JSONArray.String().
   */
  String(): string {
    return JSON.stringify(this.items)
  }

  /**
   * Called by JSON.stringify to serialize this JSONArray.
   *
   * An empty/null array is serialized as `[]` (same as Go's MarshalJSON
   * which initializes an empty map if nil).
   */
  toJSON(): T[] {
    return this.items
  }

  // --------------------------------------------------
  // Static factories
  // --------------------------------------------------

  /**
   * Creates a new JSONArray from the provided value.
   *
   * Equivalent to a combination of Scan + constructor.
   *
   * @param value - The value to populate from.
   * @returns A new JSONArray instance.
   */
  static From<T>(value: unknown): JSONArray<T> {
    const arr = new JSONArray<T>()
    arr.Scan(value)
    return arr
  }

  /**
   * Populates this JSONArray from the provided value.
   *
   * Equivalent to Go's (*JSONArray[T]).Scan(value any).
   *
   * Accepts:
   *   - null / undefined     -> initializes as empty array
   *   - T[] (Array)          -> copies elements
   *   - JSONArray<T>         -> copies elements
   *   - string               -> parses as JSON array
   *   - Uint8Array           -> decodes as UTF-8 text, then parses as JSON
   *   - other types          -> wraps in a single-element array
   */
  Scan(value: unknown): void {
    if (value === null || value === undefined) {
      this.items = []
      return
    }

    if (Array.isArray(value)) {
      this.items = [...value]
      return
    }

    if (value instanceof JSONArray) {
      this.items = [...value.items]
      return
    }

    if (typeof value === 'string') {
      if (value === '') {
        this.items = []
        return
      }
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) {
        this.items = parsed as T[]
      } else {
        // Wrap non-array in a single-element array
        this.items = [parsed as T]
      }
      return
    }

    if (value instanceof Uint8Array) {
      if (value.length === 0) {
        this.items = []
        return
      }
      const text = new TextDecoder().decode(value)
      this.Scan(text)
      return
    }

    // For other types, wrap in a single-element array
    this.items = [value as T]
  }
}
