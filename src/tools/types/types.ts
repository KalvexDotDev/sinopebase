/**
 * Package types implements some commonly used db serializable types
 * like DateTime, JSON, GeoPoint, etc.
 *
 * Port of PocketBase's tools/types package (Go -> TypeScript).
 * Layer 0: zero internal dependencies.
 */

/**
 * DefaultDateLayout specifies the default app date strings layout.
 *
 * This matches Go's reference time format: 2006-01-02 15:04:05.000Z
 */
export const DefaultDateLayout = '2006-01-02 15:04:05.000Z' as const

/**
 * DateTimeString is a branded string type representing a date-time
 * value formatted using {@link DefaultDateLayout}.
 *
 * @example
 *   const dt: DateTimeString = '2024-01-15 10:30:00.123Z'
 */
export type DateTimeString = string & { readonly __brand: unique symbol }
