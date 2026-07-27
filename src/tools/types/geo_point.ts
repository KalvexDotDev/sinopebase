/**
 * GeoPoint defines a class for storing geo coordinates as a serialized
 * JSON object (e.g. {"lon": 0, "lat": 0}).
 *
 * Port of PocketBase's tools/types/geo_point.go (Go -> TypeScript).
 *
 * Uses object notation (not a plain array) to avoid confusion, since
 * there doesn't seem to be a fixed standard for coordinate order.
 */

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/**
 * Plain object representation of a GeoPoint.
 */
export interface GeoPointData {
  /** Longitude (degrees, range -180 to 180) */
  lon: number
  /** Latitude (degrees, range -90 to 90) */
  lat: number
}

// ---------------------------------------------------------------------------
// GeoPoint class
// ---------------------------------------------------------------------------

/**
 * GeoPoint stores geographic coordinates with validation.
 *
 * The coordinates are stored as { lon, lat } to avoid ambiguity about
 * the coordinate order (some systems use [lat, lng], others [lng, lat]).
 *
 * @example
 *   const p = new GeoPoint(13.405, 52.52)   // Berlin
 *   console.log(p.String())                   // '{"lon":13.405,"lat":52.52}'
 *   console.log(p.AsMap())                    // { lon: 13.405, lat: 52.52 }
 */
export class GeoPoint {
  /**
   * Create a new GeoPoint with validation.
   *
   * @param lon - Longitude (-180 to 180). Throws if out of range or not finite.
   * @param lat - Latitude  (-90 to 90).   Throws if out of range or not finite.
   */
  /** Longitude in degrees (range: -180 to 180). */
  lon: number
  /** Latitude in degrees (range: -90 to 90). */
  lat: number

  constructor(
    /** Longitude in degrees (range: -180 to 180). */
    lon: number,
    /** Latitude in degrees (range: -90 to 90). */
    lat: number,
  ) {
    this.lon = lon
    this.lat = lat
    if (!Number.isFinite(lon) || Math.abs(lon) > 180) {
      throw new RangeError(`[GeoPoint] invalid longitude: ${lon}`)
    }
    if (!Number.isFinite(lat) || Math.abs(lat) > 90) {
      throw new RangeError(`[GeoPoint] invalid latitude: ${lat}`)
    }
  }

  /**
   * Returns the string representation of the current GeoPoint instance.
   *
   * Equivalent to Go's GeoPoint.String() (which calls json.Marshal).
   */
  String(): string {
    return JSON.stringify(this.toJSON())
  }

  /**
   * Returns a value suitable to be used in an API rule expression.
   *
   * Equivalent to Go's GeoPoint.AsMap().
   */
  AsMap(): GeoPointData {
    return { lon: this.lon, lat: this.lat }
  }

  /**
   * Called by JSON.stringify to serialize this GeoPoint.
   *
   * Returns { lon, lat } which serializes as `{"lon":...,"lat":...}`.
   */
  toJSON(): GeoPointData {
    return { lon: this.lon, lat: this.lat }
  }

  // --------------------------------------------------
  // Static factories
  // --------------------------------------------------

  /**
   * Creates a new GeoPoint from longitude and latitude coordinates.
   *
   * Equivalent to `NewGeoPoint(lon, lat)` in Go.
   *
   * @param lon - Longitude (-180 to 180).
   * @param lat - Latitude (-90 to 90).
   */
  static NewGeoPoint(lon: number, lat: number): GeoPoint {
    return new GeoPoint(lon, lat)
  }

  /**
   * Populates this GeoPoint from the provided value.
   *
   * Equivalent to Go's (*GeoPoint).Scan(value any).
   *
   * Accepts:
   *   - null / undefined     -> no-op (returns false)
   *   - GeoPoint             -> copies lon/lat
   *   - string               -> parses as JSON object with "lon" / "lat"
   *   - Uint8Array           -> decodes as UTF-8 text, then parses as JSON
   *   - object with lon/lat  -> extracts lon and lat
   *   - other types          -> JSON-stringified then re-parsed
   *
   * @returns true if the value was successfully scanned, false for null/undefined.
   * @throws {Error} if the value cannot be parsed into a valid GeoPoint.
   */
  Scan(value: unknown): boolean {
    if (value === null || value === undefined) {
      return false
    }

    if (value instanceof GeoPoint) {
      this.lon = value.lon
      this.lat = value.lat
      return true
    }

    // String input — parse as JSON
    if (typeof value === 'string') {
      if (value === '') return false
      const parsed = JSON.parse(value) as GeoPointData
      this.lon = parsed.lon
      this.lat = parsed.lat
      this.validate()
      return true
    }

    // Uint8Array — decode as UTF-8, then parse as JSON
    if (value instanceof Uint8Array) {
      if (value.length === 0) return false
      const text = new TextDecoder().decode(value)
      return this.Scan(text)
    }

    // Array — reject explicitly to avoid [lng, lat] confusion
    if (Array.isArray(value)) {
      throw new Error('[GeoPoint] array format is not accepted; use { lon, lat } object')
    }

    // Plain object with lon/lat properties
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>
      if (typeof obj.lon === 'number' && typeof obj.lat === 'number') {
        this.lon = obj.lon
        this.lat = obj.lat
        this.validate()
        return true
      }
      // Maybe the object has serialized form — marshal and re-parse
      const marshalled = JSON.stringify(obj)
      const parsed = JSON.parse(marshalled) as GeoPointData
      this.lon = parsed.lon
      this.lat = parsed.lat
      this.validate()
      return true
    }

    // For other types (numbers, booleans, etc.) — marshal and re-parse
    const marshalled = JSON.stringify(value)
    const parsed = JSON.parse(marshalled) as GeoPointData
    this.lon = parsed.lon
    this.lat = parsed.lat
    this.validate()
    return true
  }

  /**
   * Validate the current lon/lat values.
   *
   * @throws {RangeError} if coordinates are out of range.
   */
  private validate(): void {
    if (!Number.isFinite(this.lon) || Math.abs(this.lon) > 180) {
      throw new RangeError(`[GeoPoint] invalid longitude: ${this.lon}`)
    }
    if (!Number.isFinite(this.lat) || Math.abs(this.lat) > 90) {
      throw new RangeError(`[GeoPoint] invalid latitude: ${this.lat}`)
    }
  }
}
