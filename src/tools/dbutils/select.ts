/**
 * SQL select utility — extract alias or identifier from a column/table expression.
 *
 * Port of PocketBase tools/dbutils/select.go (MIT license).
 * Layer 1 -- imports Layer 0 (~/tools/...).
 */

/**
 * Regexp for matching AS aliases in column or table identifiers.
 * Same pattern as used in dbx/Kysely for identifier parsing.
 */
const selectRegex = /(?i:\s+as\s+|\s+)([\w\-\.]+)$/;

/**
 * AliasOrIdentifier returns the alias from a column or table identifier.
 *
 * For example:
 *   AliasOrIdentifier("users AS u")       // => "u"
 *   AliasOrIdentifier("users u")          // => "u"
 *   AliasOrIdentifier("users")            // => "users"
 *   AliasOrIdentifier("COUNT(*) AS cnt")  // => "cnt"
 *
 * Returns the identifier unmodified if no alias was found.
 */
export function aliasOrIdentifier(columnOrTableIdentifier: string): string {
  const matches = selectRegex.exec(columnOrTableIdentifier);
  if (matches && matches[1]) {
    return matches[1]!;
  }
  return columnOrTableIdentifier;
}
