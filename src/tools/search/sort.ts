/**
 * Sort parameter parser and builder for search queries.
 *
 * Port of PocketBase tools/search/sort.go (MIT license).
 * Layer 1 -- imports Layer 0 (~/tools/...).
 */

import type { FieldResolver } from "./simple_field_resolver";

/**
 * Special sort keys.
 */
export const RANDOM_SORT_KEY = "@random";
export const ROWID_SORT_KEY = "@rowid";

/**
 * Sort field directions.
 */
export const SORT_ASC = "ASC" as const;
export const SORT_DESC = "DESC" as const;

/**
 * A single sort field specification.
 */
export interface SortField {
  name: string;
  direction: typeof SORT_ASC | typeof SORT_DESC;
}

/**
 * BuildExpr resolves the sort field into a valid PostgreSQL ORDER BY expression.
 *
 * Special keys:
 *   - `@random`  → `RANDOM()`
 *   - `@rowid`   → `"rowid"` (or `ctid` for PostgreSQL)
 *
 * For regular fields the FieldResolver is used to map the field name to
 * a column identifier.
 */
export function buildSortExpr(
  sortField: SortField,
  fieldResolver: FieldResolver,
): string {
  // Special case for random sort
  if (sortField.name === RANDOM_SORT_KEY) {
    return "RANDOM()";
  }

  // Special case for rowid
  if (sortField.name === ROWID_SORT_KEY) {
    // PostgreSQL uses `ctid` instead of SQLite's `rowid`.
    // We return a quoted identifier for the internal row locator.
    return `"ctid" ${sortField.direction}`;
  }

  const result = fieldResolver.resolve(sortField.name);

  // Validate: must resolve to a column identifier with no params
  if (
    result instanceof Error ||
    !result ||
    Object.keys(result.params ?? {}).length > 0 ||
    !result.identifier ||
    result.identifier.toLowerCase() === "null"
  ) {
    throw new Error(`invalid sort field "${sortField.name}"`);
  }

  return `${result.identifier} ${sortField.direction}`;
}

/**
 * Parses a comma-separated sort string into an array of SortField values.
 *
 * @example
 *   parseSort("-name,+created")  // => [{name:"name", direction:"DESC"}, {name:"created", direction:"ASC"}]
 *   parseSort("name")            // => [{name:"name", direction:"ASC"}]
 */
export function parseSort(sortStr: string): SortField[] {
  const fields: SortField[] = [];

  const items = sortStr.split(",");
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("-")) {
      fields.push({ name: trimmed.slice(1), direction: SORT_DESC });
    } else {
      const name = trimmed.startsWith("+") ? trimmed.slice(1) : trimmed;
      fields.push({ name, direction: SORT_ASC });
    }
  }

  return fields;
}
