/**
 * PostgreSQL JSONB utilities — JSON path extraction helpers.
 *
 * Port of PocketBase tools/dbutils/json.go, adapted for PostgreSQL jsonb.
 * Layer 1 -- imports Layer 0 (~/tools/...).
 *
 * The original Go code targets SQLite's JSON1 extension functions
 * (JSON_EXTRACT, JSON_EACH, JSON_ARRAY_LENGTH).  This port produces
 * PostgreSQL jsonb equivalents using the -> and ->> operators.
 */

/**
 * Creates a PostgreSQL jsonb_each-like expression for the given column.
 *
 * PostgreSQL equivalent: `jsonb_each(CASE WHEN jsonb_typeof(col) = 'array' THEN col ELSE jsonb_build_array(col) END)`
 *
 * Returns an expression string suitable for use in a LATERAL join.
 *
 * @param column - The jsonb column name (will be quoted as [[column]]).
 */
export function jsonEach(column: string): string {
  // PostgreSQL jsonb_each works per-object key/value.  For array expansion,
  // use jsonb_array_elements.  This expression normalises non-json columns.
  return (
    `jsonb_array_elements(` +
    `CASE WHEN jsonb_typeof([[${column}]]) = 'array' ` +
    `THEN [[${column}]] ` +
    `ELSE jsonb_build_array([[${column}]]) END` +
    `)`
  );
}

/**
 * Returns a PostgreSQL expression for counting elements in a jsonb array column.
 *
 * Returns 0 for empty string or NULL column values.
 *
 * @param column - The jsonb column name.
 */
export function jsonArrayLength(column: string): string {
  return (
    `jsonb_array_length(` +
    `CASE WHEN jsonb_typeof([[${column}]]) = 'array' ` +
    `THEN [[${column}]] ` +
    `ELSE (CASE WHEN [[${column}]] = '' OR [[${column}]] IS NULL ` +
    `THEN jsonb_build_array() ` +
    `ELSE jsonb_build_array([[${column}]]) END) END` +
    `)`
  );
}

/**
 * Returns a PostgreSQL expression for extracting a value from a jsonb column.
 *
 * Uses the `->>` operator for text extraction (equivalent to SQLite's
 * JSON_EXTRACT as text).  Handles non-json columns by wrapping them.
 *
 * @param column - The jsonb column name.
 * @param path   - JSON path segments (e.g. "key" or ["0", "nested"]).
 *                 If empty, the root of the jsonb value is returned as text.
 */
export function jsonExtract(column: string, path: string): string {
  // Build a PostgreSQL jsonb path using -> and ->>
  // For simple paths like "key" → col->>'key'
  // For array paths like "0" → col->>0
  // For nested paths like "key.sub" → col->'key'->>'sub'

  if (!path) {
    // Root extraction: cast to text
    return `[[${column}]]::text`;
  }

  // Split the path into segments
  const segments = path.split(".").filter(Boolean);

  if (segments.length === 0) {
    return `[[${column}]]::text`;
  }

  // Build nested access: for all but the last segment use -> (returns jsonb),
  // for the last segment use ->> (returns text)
  let expr = `[[${column}]]`;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const isLast = i === segments.length - 1;
    // Array index check (numeric segments = array indices)
    const isArrayIndex = /^\d+$/.test(seg);
    const key = isArrayIndex ? seg : `'${seg}'`;
    expr = isLast ? `${expr}->>${key}` : `${expr}->${key}`;
  }

  // Handle non-json columns by wrapping with a CASE
  return (
    `(CASE WHEN jsonb_typeof([[${column}]]) IS NOT NULL ` +
    `THEN ${expr} ` +
    `ELSE CAST(jsonb_build_object('pb', [[${column}]])->>'pb' AS text) END)`
  );
}

/**
 * Returns a PostgreSQL expression for extracting a jsonb sub-object
 * using the `->` operator (returns jsonb, not text).
 *
 * @param column - The jsonb column name.
 * @param path   - Dot-separated path (e.g. "key" or "key.sub").
 */
export function jsonExtractObject(column: string, path: string): string {
  if (!path) {
    return `[[${column}]]`;
  }

  const segments = path.split(".").filter(Boolean);
  let expr = `[[${column}]]`;
  for (const seg of segments) {
    const isArrayIndex = /^\d+$/.test(seg);
    expr = isArrayIndex ? `${expr}->${seg}` : `${expr}->'${seg}'`;
  }

  return expr;
}
