/**
 * Port of PocketBase tools/list/list.go
 *
 * Slice/list utility functions.
 * Layer 0 -- zero internal dependencies.
 */

// ---------------------------------------------------------------------------
// SubtractSlice
// ---------------------------------------------------------------------------

/**
 * Returns elements from `base` that are not present in `subtract`.
 *
 * @example
 *   SubtractSlice([1, 2, 3, 4], [2, 4]) // => [1, 3]
 */
export function SubtractSlice<T>(base: T[], subtract: T[]): T[] {
  const excludeSet = new Set(subtract)
  return base.filter((item) => !excludeSet.has(item))
}

// ---------------------------------------------------------------------------
// ExistInSlice
// ---------------------------------------------------------------------------

/**
 * Checks whether an item exists in a slice using strict equality.
 *
 * @example
 *   ExistInSlice("a", ["a", "b"]) // => true
 */
export function ExistInSlice<T>(item: T, slice: T[]): boolean {
  return slice.includes(item)
}

// ---------------------------------------------------------------------------
// ExistInSliceWithRegex
// ---------------------------------------------------------------------------

const regexCache = new Map<string, RegExp>()
const REGEX_CACHE_LIMIT = 500

/**
 * Checks whether `str` exists in `slice` either by direct match or, when an
 * element starts with `"^"` and ends with `"$"`, via regex matching.
 *
 * Compiled regex patterns are cached (up to 500 entries).
 *
 * @example
 *   ExistInSliceWithRegex("foo123", ["^foo\\d+$"]) // => true
 */
export function ExistInSliceWithRegex(str: string, slice: string[]): boolean {
  for (const pattern of slice) {
    if (pattern.startsWith('^') && pattern.endsWith('$')) {
      let re = regexCache.get(pattern)
      if (re === undefined) {
        if (regexCache.size >= REGEX_CACHE_LIMIT) {
          const firstKey = regexCache.keys().next().value
          if (firstKey !== undefined) {
            regexCache.delete(firstKey)
          }
        }
        re = new RegExp(pattern)
        regexCache.set(pattern, re)
      }
      if (re.test(str)) {
        return true
      }
    } else if (str === pattern) {
      return true
    }
  }
  return false
}

/**
 * Clears the internal regex cache used by {@link ExistInSliceWithRegex}.
 * Primarily useful in tests.
 */
export function clearRegexCache(): void {
  regexCache.clear()
}

// ---------------------------------------------------------------------------
// ToInterfaceSlice
// ---------------------------------------------------------------------------

/**
 * Converts a typed array to an array of unknown values.
 *
 * @example
 *   ToInterfaceSlice([1, 2, 3]) // => [1, 2, 3] (typed as unknown[])
 */
export function ToInterfaceSlice<T>(slice: T[]): unknown[] {
  return [...slice]
}

// ---------------------------------------------------------------------------
// NonzeroUniques
// ---------------------------------------------------------------------------

/**
 * Returns only nonzero unique values from the input slice.
 *
 * For primitives an element is considered "zero" when it is:
 *   - `null` / `undefined`
 *   - `""` (empty string)
 *   - `0` / `0n`
 *   - `false`
 *
 * Object references are always treated as nonzero and deduped by reference.
 *
 * @example
 *   NonzeroUniques([0, 1, "", "x", "x", false, true])
 *   // => [1, "x", true]
 */
export function NonzeroUniques<T>(slice: T[]): T[] {
  const seen = new Set<T>()
  const result: T[] = []
  for (const item of slice) {
    if (isZeroValue(item)) {
      continue
    }
    if (seen.has(item)) {
      continue
    }
    seen.add(item)
    result.push(item)
  }
  return result
}

function isZeroValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true
  }
  if (typeof value === 'string' && value === '') {
    return true
  }
  if (typeof value === 'number' && value === 0) {
    return true
  }
  if (typeof value === 'bigint' && value === 0n) {
    return true
  }
  if (typeof value === 'boolean' && value === false) {
    return true
  }
  return false
}

// ---------------------------------------------------------------------------
// ToUniqueStringSlice
// ---------------------------------------------------------------------------

/**
 * Converts a value to a slice of unique, non-zero strings.
 *
 * Handles the following input shapes:
 *   - `null` / `undefined` -- returns `[]`
 *   - `string[]` -- maps each element through `String()` and dedup/filter
 *   - A plain `string` -- returns `[str]`; if the string looks like a JSON
 *     array (`[...]`) it is parsed first
 *   - Everything else -- wrapped in `[String(value)]` then dedup/filter
 *
 * @example
 *   ToUniqueStringSlice('["a","b","a"]') // => ["a", "b"]
 *   ToUniqueStringSlice("hello")         // => ["hello"]
 */
export function ToUniqueStringSlice(value: unknown): string[] {
  if (value === null || value === undefined) {
    return []
  }

  if (Array.isArray(value)) {
    return NonzeroUniques(value.map((v) => String(v)))
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) {
          return NonzeroUniques(parsed.map((v) => String(v)))
        }
      } catch {
        // Not valid JSON array -- fall through to single-string path.
      }
    }
    return NonzeroUniques([value])
  }

  return NonzeroUniques([String(value)])
}

// ---------------------------------------------------------------------------
// ToChunks
// ---------------------------------------------------------------------------

/**
 * Splits a slice into chunks of the given size.
 *
 * A `size` less than 1 defaults to 1.
 *
 * @example
 *   ToChunks([1, 2, 3, 4, 5], 2) // => [[1, 2], [3, 4], [5]]
 */
export function ToChunks<T>(slice: T[], size: number): T[][] {
  if (size < 1) {
    size = 1
  }
  const chunks: T[][] = []
  for (let i = 0; i < slice.length; i += size) {
    chunks.push(slice.slice(i, i + size))
  }
  return chunks
}
