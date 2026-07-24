/**
 * Field resolver interface and simple implementation for search queries.
 *
 * Port of PocketBase tools/search/simple_field_resolver.go (MIT license).
 * Layer 1 -- imports Layer 0 (~/tools/...).
 */

import { Columnify } from "~/tools/inflector/inflector";
import { ExistInSliceWithRegex } from "~/tools/list/list";

// ---------------------------------------------------------------------------
// Enums and interfaces
// ---------------------------------------------------------------------------

/**
 * Preference for NULL/empty value handling in resolved fields.
 */
export const NullFallbackPreference = {
  /** Automatically determine whether to apply COALESCE fallback (default). */
  Auto: 0,
  /** Never apply COALESCE or NULL fallbacks (e.g. for JSON fields). */
  Disabled: 1,
  /** Always prefer COALESCE or NULL fallbacks when needed. */
  Enforced: 2,
} as const;

export type NullFallbackPreference = (typeof NullFallbackPreference)[keyof typeof NullFallbackPreference];

/**
 * Result of a successful field resolution.
 */
export interface ResolverResult {
  /**
   * The SQL identifier/column expression for use in the final expression.
   */
  identifier: string;

  /**
   * Preference for how NULL or empty values should be resolved.
   * Defaults to Auto.
   */
  nullFallback?: NullFallbackPreference;

  /**
   * Parameter placeholder → value pairs for the query.
   */
  params?: Record<string, unknown>;

  /**
   * Optional sub-query for multi-match relation fields.
   */
  multiMatchSubQuery?: unknown;

  /**
   * Optional callback invoked after the expression is built.
   */
  afterBuild?: ((sql: string) => string) | null;
}

/**
 * FieldResolver resolves search field names to SQL identifiers.
 */
export interface FieldResolver {
  /**
   * Allows the resolver to modify the base query (e.g. add JOINs)
   * before the search executes.
   */
  updateQuery(query: unknown): Promise<void> | void;

  /**
   * Resolves a field name to a SQL identifier/expression.
   *
   * @param field - The field name to resolve (e.g. "name", "relation.field").
   * @returns A ResolverResult, or an Error if the field cannot be resolved.
   */
  resolve(field: string): ResolverResult | Error;
}

// ---------------------------------------------------------------------------
// SimpleFieldResolver
// ---------------------------------------------------------------------------

/**
 * SimpleFieldResolver is a generic field resolver that allows only its
 * listed fields to be resolved and take part in a search query.
 *
 * If `allowedFields` is empty, no field filtering is applied.
 *
 * Each allowed field can be a plain string (e.g. "name") or a regex
 * pattern (e.g. "^\\w+[\\w\\.]*$").
 */
export class SimpleFieldResolver implements FieldResolver {
  private readonly allowedFields: string[]

  constructor(allowedFields: string[]) {
    this.allowedFields = allowedFields
  }

  /**
   * No-op -- the simple resolver does not modify the base query.
   */
  updateQuery(_query: unknown): void {
    // nothing to update
  }

  /**
   * Resolves a field name to a SQL identifier.
   *
   * Supports:
   *   - Simple fields: `name` → `"name"`
   *   - Dotted paths (JSON): `data.email` → `"data"->>'email'`
   *   - Multi-level paths: `meta.address.city` → `"meta"->'address'->>'city'`
   *
   * Returns an Error if the field is not in the allowed list.
   */
  resolve(field: string): ResolverResult | Error {
    // If allowedFields is empty, no field filtering is applied (all fields allowed).
    if (this.allowedFields.length > 0 && !ExistInSliceWithRegex(field, this.allowedFields)) {
      return new Error(`failed to resolve field "${field}"`);
    }

    const parts = field.split(".");

    // Single regular field
    if (parts.length === 1) {
      return {
        identifier: `[[${Columnify(parts[0]!)}]]`,
      };
    }

    // Treat as JSON path using PostgreSQL jsonb operators
    const root = Columnify(parts[0]!);
    const rest = parts.slice(1);

    // Build PostgreSQL jsonb path using -> and ->>
    let expr = `[[${root}]]`;
    for (let i = 0; i < rest.length; i++) {
      const seg = rest[i]!;
      const isArrayIndex = /^\d+$/.test(seg);
      const isLast = i === rest.length - 1;
      if (isLast) {
        // Last segment: use ->> for text extraction
        expr = isArrayIndex
          ? `${expr}->>${seg}`
          : `${expr}->>'${Columnify(seg)}'`;
      } else {
        // Non-last segment: use -> for jsonb object navigation
        expr = isArrayIndex
          ? `${expr}->${seg}`
          : `${expr}->'${Columnify(seg)}'`;
      }
    }

    return {
      nullFallback: NullFallbackPreference.Disabled,
      identifier: expr,
    };
  }
}
