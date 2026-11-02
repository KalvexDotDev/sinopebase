/**
 * Storage object name rules (sinope#1111).
 *
 * Storage policies read an object's owner prefix from its first name segment,
 * while file stores resolve the whole name to a path or key. An empty, `.` or
 * `..` segment (including a leading or trailing `/`) lets those two readings
 * disagree, so a name could pass one prefix's policy and land in another's.
 */

/** Matches an empty, `.` or `..` segment anywhere in a name. */
const UNSAFE_SEGMENT = /(?:^|\/)\.{0,2}(?:\/|$)/

export function isValidObjectName(name: unknown): name is string {
  return typeof name === 'string' && !UNSAFE_SEGMENT.test(name)
}

/** List prefixes are `''` (bucket root) or a valid name with an optional trailing `/`. */
export function isValidObjectPrefix(prefix: unknown): prefix is string {
  if (prefix === '') return true
  return isValidObjectName(typeof prefix === 'string' ? prefix.replace(/\/$/, '') : prefix)
}
