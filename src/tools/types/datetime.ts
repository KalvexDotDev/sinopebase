/**
 * DateTime represents a Date instance in UTC that is wrapped
 * and serialized using the app default date layout.
 *
 * Port of PocketBase's tools/types/datetime.go (Go -> TypeScript).
 *
 * Patterns:
 *   - Go's time.Time       -> TypeScript Date
 *   - Go's sql.Scanner     -> Scan() / static factory methods
 *   - Go's driver.Valuer   -> toJSON() / String()
 *   - Go's json.Marshaler  -> toJSON()
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse a date string using the DefaultDateLayout pattern:
 *   YYYY-MM-DD HH:mm:ss.SSSZ
 *
 * Returns null if the string does not match the expected format.
 */
function parseDateFromLayout(str: string): Date | null {
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/)
  if (!match) return null

  return new Date(
    Date.UTC(
      Number(match[1] as string),
      Number(match[2] as string) - 1, // JS months are 0-indexed
      Number(match[3] as string),
      Number(match[4] as string),
      Number(match[5] as string),
      Number(match[6] as string),
      Number(match[7] as string),
    ),
  )
}

/**
 * Format a Date into the DefaultDateLayout string (always UTC).
 *
 * Equivalent to Go's time.Time.UTC().Format(DefaultDateLayout).
 */
function formatToLayout(d: Date): string {
  const y = d.getUTCFullYear().toString().padStart(4, '0')
  const mo = (d.getUTCMonth() + 1).toString().padStart(2, '0')
  const da = d.getUTCDate().toString().padStart(2, '0')
  const h = d.getUTCHours().toString().padStart(2, '0')
  const mi = d.getUTCMinutes().toString().padStart(2, '0')
  const s = d.getUTCSeconds().toString().padStart(2, '0')
  const ms = d.getUTCMilliseconds().toString().padStart(3, '0')

  return `${y}-${mo}-${da} ${h}:${mi}:${s}.${ms}Z`
}

// ---------------------------------------------------------------------------
// DateTime class
// ---------------------------------------------------------------------------

/**
 * DateTime wraps a JavaScript Date in UTC and provides serialization
 * using the app-default date layout (DefaultDateLayout).
 *
 * A zero / unset DateTime is represented by a null internal Date.
 *
 * @example
 *   const dt = DateTime.NowDateTime()
 *   console.log(dt.String())  // "2024-01-15 10:30:00.123Z"
 *   console.log(dt.IsZero())  // false
 */
export class DateTime {
  /** Internal Date instance; null represents the zero / unset value. */
  private date: Date | null

  /**
   * Create a DateTime instance.
   *
   * @param date - A Date object, or null/undefined for the zero value.
   */
  constructor(date?: Date | null) {
    if (date !== null && date !== undefined) {
      if (Number.isNaN(date.getTime())) {
        this.date = null
      } else {
        this.date = date
      }
    } else {
      this.date = null
    }
  }

  // --------------------------------------------------
  // Accessors
  // --------------------------------------------------

  /**
   * Returns the internal Date instance.
   *
   * Equivalent to Go's DateTime.Time().
   *
   * @returns The Date object, or null if the DateTime is zero/unset.
   */
  Time(): Date | null {
    return this.date
  }

  /**
   * Reports whether the current DateTime instance has a zero/unset time value.
   *
   * Equivalent to Go's DateTime.IsZero().
   */
  IsZero(): boolean {
    return this.date === null
  }

  // --------------------------------------------------
  // Arithmetic
  // --------------------------------------------------

  /**
   * Returns a new DateTime based on the current DateTime plus the specified
   * duration in milliseconds.
   *
   * Equivalent to Go's DateTime.Add(duration).
   *
   * @param durationMs - Duration to add, in milliseconds.
   */
  Add(durationMs: number): DateTime {
    if (this.IsZero()) return new DateTime(null)
    return new DateTime(new Date(this.date?.getTime() + durationMs))
  }

  /**
   * Returns the difference in milliseconds by subtracting the specified
   * DateTime from the current one.
   *
   * Equivalent to Go's DateTime.Sub(u).
   *
   * @param u - The DateTime to subtract.
   */
  Sub(u: DateTime): number {
    const a = this.date?.getTime() ?? 0
    const b = u.date?.getTime() ?? 0
    return a - b
  }

  /**
   * Returns a new DateTime based on the current one plus the specified
   * years, months, and days.
   *
   * Equivalent to Go's DateTime.AddDate(years, months, days).
   *
   * @param years  - Number of years to add (can be negative).
   * @param months - Number of months to add (can be negative).
   * @param days   - Number of days to add (can be negative).
   */
  AddDate(years: number, months: number, days: number): DateTime {
    if (this.IsZero()) return new DateTime(null)
    const d = new Date(this.date?.getTime())
    d.setUTCFullYear(d.getUTCFullYear() + years)
    d.setUTCMonth(d.getUTCMonth() + months)
    d.setUTCDate(d.getUTCDate() + days)
    return new DateTime(d)
  }

  // --------------------------------------------------
  // Comparison
  // --------------------------------------------------

  /**
   * Reports whether the current DateTime instance is after u.
   *
   * Equivalent to Go's DateTime.After(u).
   */
  After(u: DateTime): boolean {
    if (this.IsZero() || u.IsZero()) return false
    return this.date?.getTime() > u.date?.getTime()
  }

  /**
   * Reports whether the current DateTime instance is before u.
   *
   * Equivalent to Go's DateTime.Before(u).
   */
  Before(u: DateTime): boolean {
    if (this.IsZero() || u.IsZero()) return false
    return this.date?.getTime() < u.date?.getTime()
  }

  /**
   * Compares the current DateTime instance with u.
   *
   * Equivalent to Go's DateTime.Compare(u).
   *
   * @returns -1 if the current instance is before u,
   *           0 if they are equal,
   *          +1 if the current instance is after u.
   */
  Compare(u: DateTime): -1 | 0 | 1 {
    if (this.IsZero() && u.IsZero()) return 0
    if (this.IsZero()) return -1
    if (u.IsZero()) return 1

    const diff = this.date?.getTime() - u.date?.getTime()
    if (diff < 0) return -1
    if (diff > 0) return 1
    return 0
  }

  /**
   * Reports whether the current DateTime and u represent the same time instant.
   *
   * Equivalent to Go's DateTime.Equal(u).
   *
   * Two DateTime instances can be equal even if they were created from
   * different Date objects representing the same instant.
   */
  Equal(u: DateTime): boolean {
    if (this.IsZero() && u.IsZero()) return true
    if (this.IsZero() || u.IsZero()) return false
    return this.date?.getTime() === u.date?.getTime()
  }

  // --------------------------------------------------
  // Conversion
  // --------------------------------------------------

  /**
   * Returns the current DateTime as a Unix timestamp
   * (number of seconds elapsed since January 1, 1970 UTC).
   *
   * Equivalent to Go's DateTime.Unix().
   */
  Unix(): number {
    if (this.IsZero()) return 0
    return Math.floor(this.date?.getTime() / 1000)
  }

  /**
   * Serializes the current DateTime instance into a formatted UTC date string.
   *
   * The zero value is serialized to an empty string.
   *
   * Equivalent to Go's DateTime.String().
   */
  String(): string {
    if (this.IsZero()) return ''
    const d = this.date
    if (d === null) return ''
    return formatToLayout(d)
  }

  // --------------------------------------------------
  // JSON serialization
  // --------------------------------------------------

  /**
   * Called by JSON.stringify to serialize this DateTime.
   *
   * Returns the formatted UTC date string (or empty string for zero value),
   * which JSON.stringify will then quote as a JSON string.
   *
   * Equivalent to Go's MarshalJSON producing `"2006-01-02 15:04:05.000Z"`.
   */
  toJSON(): string {
    return this.String()
  }

  // --------------------------------------------------
  // Static factories
  // --------------------------------------------------

  /**
   * Returns a new DateTime instance with the current local time.
   *
   * Equivalent to Go's NowDateTime().
   */
  static NowDateTime(): DateTime {
    return new DateTime(new Date())
  }

  /**
   * Creates a new DateTime from the provided value.
   *
   * Accepts the same value types as Scan():
   *   - Date objects
   *   - DateTime instances
   *   - Strings (parsed via DefaultDateLayout first, then Date.parse fallback)
   *   - Numbers (treated as Unix seconds, or milliseconds if > 1e12)
   *   - null / undefined (returns zero DateTime)
   *
   * Equivalent to Go's ParseDateTime(value any) (DateTime, error).
   *
   * @param value - The value to parse.
   * @returns A new DateTime instance.
   */
  static ParseDateTime(value: unknown): DateTime {
    const dt = new DateTime()
    dt.Scan(value)
    return dt
  }

  // --------------------------------------------------
  // Scan (populate from value)
  // --------------------------------------------------

  /**
   * Populates this DateTime instance from the provided value.
   *
   * Equivalent to Go's (*DateTime).Scan(value any).
   *
   * Handles:
   *   - null / undefined   -> zero (unset) DateTime
   *   - Date               -> wraps the Date
   *   - DateTime           -> copies the internal Date
   *   - string             -> tries DefaultDateLayout first,
   *                           falls back to Date.parse
   *   - number             -> treated as Unix seconds (or ms if > 1e12)
   *   - other types        -> converted to string, then Date.parse
   */
  Scan(value: unknown): void {
    if (value === null || value === undefined) {
      this.date = null
      return
    }

    if (value instanceof Date) {
      this.date = Number.isNaN(value.getTime()) ? null : value
      return
    }

    if (value instanceof DateTime) {
      this.date = value.date
      return
    }

    if (typeof value === 'string') {
      if (value === '') {
        this.date = null
        return
      }

      // Try the default layout first
      const fromLayout = parseDateFromLayout(value)
      if (fromLayout !== null) {
        this.date = fromLayout
        return
      }

      // Fallback to JavaScript Date.parse for other common formats
      const d = new Date(value)
      this.date = Number.isNaN(d.getTime()) ? new Date(NaN) : d
      return
    }

    if (typeof value === 'number') {
      // Go's cast.ToTime treats int types as Unix seconds.
      // If the value is > 1e12, treat as milliseconds (more common in JS).
      const ms = value > 1e12 ? value : value * 1000
      const d = new Date(ms)
      this.date = Number.isNaN(d.getTime()) ? null : d
      return
    }

    // For other types (objects, booleans, etc.), try string conversion
    const str = String(value)
    if (str === '') {
      this.date = null
    } else {
      const d = new Date(str)
      this.date = Number.isNaN(d.getTime()) ? null : d
    }
  }
}
