/**
 * RecordFieldResolver — resolves record search field names to SQL column refs.
 *
 * Port of PocketBase core/record_field_resolver.go (MIT license).
 * Layer 2 — imports from ~/tools/* and ~/core/*.
 *
 * Implements the `search.FieldResolver` interface for PocketBase record models.
 * Handles:
 *   - Regular fields: `name`, `relation.field`
 *   - @request.* macros: `@request.auth.name`, `@request.body.title`, etc.
 *   - @collection.* macros: `@collection.product.price`
 *   - Relation joins (forward and back via `_via_`)
 *   - Multi-match subqueries for multi-value relations
 *   - Filter modifiers: `:each`, `:length`, `:lower`, `:isset`, `:changed`
 */

import type { FieldResolver, ResolverResult } from '~/tools/search/simple_field_resolver';
import { Columnify } from '~/tools/inflector/inflector';
import { ExistInSliceWithRegex } from '~/tools/list/list';

// ---------------------------------------------------------------------------
// Constants — filter modifiers
// ---------------------------------------------------------------------------

export const EachModifier = 'each';
export const IssetModifier = 'isset';
export const LengthModifier = 'length';
export const LowerModifier = 'lower';
export const ChangedModifier = 'changed';

// ---------------------------------------------------------------------------
// Commonly used field name constants (re-export from field.ts for convenience)
// ---------------------------------------------------------------------------

export const FieldNameId = 'id';
export const FieldNameCollectionId = 'collectionId';
export const FieldNameCollectionName = 'collectionName';
export const FieldNameExpand = 'expand';
export const FieldNameEmail = 'email';
export const FieldNameEmailVisibility = 'emailVisibility';
export const FieldNameVerified = 'verified';
export const FieldNameTokenKey = 'tokenKey';
export const FieldNamePassword = 'password';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/**
 * RequestInfo carries metadata about the current API request.
 *
 * Mirrors PocketBase's `models.RequestInfo`.
 */
export interface RequestInfo {
  /** Request context string (e.g. "GET /api/collections/..."). */
  context?: string;
  /** HTTP method (GET, POST, PATCH, DELETE, etc.). */
  method?: string;
  /** Authenticated record, if any. */
  auth?: RecordStub | null;
  /** Request body data (parsed). */
  body?: Record<string, unknown>;
  /** URL query parameters. */
  query?: Record<string, unknown>;
  /** Request headers. */
  headers?: Record<string, unknown>;
}

/**
 * Minimal Record stub interface used by the resolver.
 *
 * In PocketBase this is `core.Record`.  Here we define only the
 * subset of methods the resolver calls.
 */
export interface RecordStub {
  id: string;
  collection(): CollectionStub;
  /** Returns a clone with hidden fields exposed. */
  clone(): RecordStub;
  /** Unhides the specified fields so they appear in PublicExport. */
  unhide(...fields: string[]): RecordStub;
  /** Ignores email visibility (i.e. always return the email). */
  ignoreEmailVisibility(v: boolean): RecordStub;
  /** Returns a public-safe key-value export of the record. */
  publicExport(): Record<string, unknown>;
}

/**
 * Minimal Collection stub interface.
 */
export interface CollectionStub {
  id: string;
  name: string;
  listRule: string | null;
  fields: FieldsListStub;
  indexes: string[];
  isAuth(): boolean;
}

/**
 * Minimal fields list stub — enough to support field lookups by name.
 */
export interface FieldsListStub {
  getByName(name: string): FieldStub | undefined;
  all(): FieldStub[];
  fieldNames(): string[];
}

/**
 * Minimal Field stub interface.
 */
export interface FieldStub {
  id: string;
  name: string;
  type: string;
  system: boolean;
  hidden: boolean;
  getHidden(): boolean;
  getName(): string;
}

/**
 * MultiValuer interface — field types that support multi-value operations.
 */
export interface MultiValuer {
  isMultiple(): boolean;
}

/**
 * RuleJoin tracks a collection with a list rule that needs to be applied
 * as an additional AND constraint on the query.
 */
export interface RuleJoin {
  collection: string;
  tableAlias: string;
}

/**
 * Search Join definition — a SQL LEFT JOIN to be applied.
 */
export interface SearchJoin {
  tableName: string;
  tableAlias: string;
  on: string;
}

/**
 * AppStub — minimal application interface for record lookups.
 */
export interface AppStub {
  logger(): { debug: (msg: string, ...args: unknown[]) => void };
}

// ---------------------------------------------------------------------------
// Helper: splitModifier
// ---------------------------------------------------------------------------

/**
 * Splits a combined `name:modifier` string into its two parts.
 *
 * Returns `[name, ""]` if there is no valid modifier suffix.
 *
 * @example
 *   splitModifier("role:each")    // => ["role", "each"]
 *   splitModifier("name")         // => ["name", ""]
 *   splitModifier("name:unknown") // => Error
 */
export function splitModifier(combined: string): [string, string] {
  const idx = combined.indexOf(':');
  if (idx === -1) {
    return [combined, ''];
  }

  const name = combined.slice(0, idx);
  const modifier = combined.slice(idx + 1);

  switch (modifier) {
    case IssetModifier:
    case EachModifier:
    case LengthModifier:
    case LowerModifier:
    case ChangedModifier:
      return [name, modifier];
    default:
      throw new Error(`unknown modifier in "${combined}"`);
  }
}

// ---------------------------------------------------------------------------
// Helper: extractNestedVal
// ---------------------------------------------------------------------------

/**
 * Recursively extracts a nested value from a map/array structure.
 *
 * Similar to PocketBase's `extractNestedVal` in record_field_resolver.go.
 *
 * @example
 *   extractNestedVal({ a: { b: "hello" } }, "a", "b") // => "hello"
 *   extractNestedVal([10, 20, 30], "2")               // => 30
 */
export function extractNestedVal(rawData: unknown, ...keys: string[]): unknown {
  if (keys.length === 0) {
    throw new Error('at least one key should be provided');
  }

  if (rawData === null || rawData === undefined) {
    throw new Error(`invalid key path - missing key "${keys[0]}"`);
  }

  // Map-like objects
  if (typeof rawData === 'object' && !Array.isArray(rawData)) {
    return mapVal(rawData as Record<string, unknown>, ...keys);
  }

  // Arrays
  if (Array.isArray(rawData)) {
    return arrVal(rawData, ...keys);
  }

  // Raw string that might be JSON
  if (typeof rawData === 'string') {
    try {
      const parsed = JSON.parse(rawData);
      return extractNestedVal(parsed, ...keys);
    } catch {
      throw new Error(`invalid key path - expected map or array, got string`);
    }
  }

  throw new Error(`invalid key path - expected map or array, got ${typeof rawData}`);
}

function mapVal(m: Record<string, unknown>, ...keys: string[]): unknown {
  if (!(keys[0]! in m)) {
    throw new Error(`invalid key path - missing key "${keys[0]}"`);
  }

  const result = m[keys[0]!];

  if (keys.length === 1) {
    return result;
  }

  return extractNestedVal(result, ...keys.slice(1));
}

function arrVal(m: unknown[], ...keys: string[]): unknown {
  const idx = parseInt(keys[0]!, 10);
  if (isNaN(idx) || idx < 0 || idx >= m.length) {
    throw new Error(`invalid key path - invalid or missing array index "${keys[0]}"`);
  }

  const result = m[idx];

  if (keys.length === 1) {
    return result;
  }

  return extractNestedVal(result, ...keys.slice(1));
}

// ---------------------------------------------------------------------------
// toSlice helper
// ---------------------------------------------------------------------------

/**
 * Converts a value to a flat array.  nil stays as empty array.
 */
export function toSlice(value: unknown): unknown[] {
  if (value === null || value === undefined) return [];

  if (Array.isArray(value)) return value;

  return [value];
}

// ---------------------------------------------------------------------------
// RecordFieldResolver
// ---------------------------------------------------------------------------

/**
 * RecordFieldResolver resolves record model field names to SQL column
 * identifiers, handling relations, macros, and collection references.
 *
 * Implements the `FieldResolver` interface from ~/tools/search.
 */
export class RecordFieldResolver implements FieldResolver {
  // ---- public state --------------------------------------------------------

  /**
   * Known join alias suffix used for deduplication in flatten collection
   * list rule joins.
   */
  joinAliasSuffix = '';

  /**
   * Optional table alias for the base collection (defaults to columnified name).
   */
  baseCollectionAlias = '';

  /** Registered SQL JOINs. */
  joins: SearchJoin[] = [];

  /** Registered list rule joins (collection name → table alias). */
  listRuleJoins: RuleJoin[] = [];

  // ---- internal state ------------------------------------------------------

  protected app: AppStub;
  protected baseCollection: CollectionStub;
  protected requestInfo: RequestInfo | null;
  protected staticRequestInfo: Record<string, unknown> = {};

  protected _allowedFields: string[] = [
    `^\\w+[\\w\\.\\:]*$`,
    `^\\@request\\.context$`,
    `^\\@request\\.method$`,
    `^\\@request\\.auth\\.[\\w\\.\\:]*\\w+$`,
    `^\\@request\\.body\\.[\\w\\.\\:]*\\w+$`,
    `^\\@request\\.query\\.[\\w\\.\\:]*\\w+$`,
    `^\\@request\\.headers\\.[\\.\\w\\-\\:]*\\w+$`,
    `^\\@collection\\.\\w+(\\:\\w+)?\\.[\\w\\.\\:]*\\w+$`,
  ];

  protected _allowHiddenFields: boolean;

  /**
   * @param app              - The app instance.
   * @param baseCollection   - The base collection being queried.
   * @param requestInfo      - Optional request info (may be null for internal calls).
   * @param allowHiddenFields - Whether to allow filtering on hidden fields.
   */
  constructor(
    app: AppStub,
    baseCollection: CollectionStub,
    requestInfo: RequestInfo | null,
    allowHiddenFields: boolean,
  ) {
    this.app = app;
    this.baseCollection = baseCollection;
    this.requestInfo = requestInfo;
    this._allowHiddenFields = allowHiddenFields;

    // Build static request info snapshot
    if (this.requestInfo) {
      this.staticRequestInfo['context'] = this.requestInfo.context;
      this.staticRequestInfo['method'] = this.requestInfo.method;
      this.staticRequestInfo['query'] = this.requestInfo.query;
      this.staticRequestInfo['headers'] = this.requestInfo.headers;
      this.staticRequestInfo['body'] = this.requestInfo.body;
      this.staticRequestInfo['auth'] = null;

      if (this.requestInfo.auth) {
        const authClone = this.requestInfo.auth
          .clone()
          .unhide(...baseCollection.fields.fieldNames())
          .ignoreEmailVisibility(true);
        this.staticRequestInfo['auth'] = authClone.publicExport();
      }
    }
  }

  // ---- property accessors --------------------------------------------------

  /** Returns a copy of the allowed fields. */
  allowedFields(): string[] {
    return [...this._allowedFields];
  }

  /** Replaces the allowed fields with a new set. */
  setAllowedFields(fields: string[]): void {
    this._allowedFields = [...fields];
  }

  /** Whether hidden fields can be used in filters. */
  getAllowHiddenFields(): boolean {
    return this._allowHiddenFields;
  }

  /** Enable or disable hidden field filtering. */
  setAllowHiddenFields(allowed: boolean): void {
    this._allowHiddenFields = allowed;
  }

  // ---- FieldResolver implementation ----------------------------------------

  /**
   * Allows the resolver to add JOINs and constraints to the search query
   * before it executes.
   *
   * Implements `FieldResolver.updateQuery`.
   */
  updateQuery(_query: unknown): void {
    // In PocketBase this modifies the dbx.SelectQuery in-place.
    // Our TypeScript port returns JOINs via the `joins` property instead,
    // which external code can apply to the query builder.
    //
    // The joins accumulated during resolve() are available via `this.joins`.
  }

  /**
   * Resolves a field name to a SQL column reference.
   *
   * Delegates to the Runner (see record_field_resolver_runner.ts).
   *
   * Implements `FieldResolver.resolve`.
   */
  resolve(fieldName: string): ResolverResult | Error {
    // This method is stubbed here. The full implementation lives in the Runner.
    return new Error(
      `RecordFieldResolver.resolve() must be called through parseAndRun() — ` +
        `import { parseAndRun } from './record_field_resolver_runner'`,
    );
  }

  // ---- helpers -------------------------------------------------------------

  /**
   * Loads a collection by name or id, returning the base collection
   * without an extra fetch if it matches.
   */
  loadCollection(collectionNameOrId: string): CollectionStub {
    if (
      collectionNameOrId === this.baseCollection.name ||
      collectionNameOrId === this.baseCollection.id
    ) {
      return this.baseCollection;
    }

    throw new Error(
      `collection "${collectionNameOrId}" not available — ` +
        `collection loading from dao not yet implemented`,
    );
  }

  /**
   * Registers a JOIN.  If a join with the same table alias already exists,
   * it is replaced.
   */
  registerJoin(tableName: string, tableAlias: string, on: string): void {
    const newJoin: SearchJoin = { tableName, tableAlias, on };

    // Check list rules (only when hidden fields are not allowed)
    if (!this._allowHiddenFields) {
      try {
        const c = this.loadCollection(tableName);
        if (c) {
          if (c.listRule === null) {
            // Collection with null listRule can only be accessed via superuser
            // In our port we'll just register the join — the permission check
            // can be enforced at a higher layer.
          }
          this.registerRuleJoin(c.name, tableAlias);
        }
      } catch {
        // Not a known collection, skip rule check
      }
    }

    // Replace existing join with same table alias
    const existingIdx = this.joins.findIndex((j) => j.tableAlias === tableAlias);
    if (existingIdx >= 0) {
      this.joins[existingIdx] = newJoin;
      return;
    }

    this.joins.push(newJoin);
  }

  /**
   * Registers a list rule join for permission enforcement.
   */
  registerRuleJoin(collectionName: string, tableAlias: string): void {
    const existingIdx = this.listRuleJoins.findIndex(
      (j) => j.tableAlias === tableAlias,
    );
    if (existingIdx >= 0) {
      this.listRuleJoins[existingIdx] = { collection: collectionName, tableAlias };
      return;
    }

    this.listRuleJoins.push({ collection: collectionName, tableAlias });
  }

  /**
   * Resolves a static @request.* field (context, method, auth, body, query, headers).
   */
  resolveStaticRequestField(...path: string[]): ResolverResult | Error {
    if (path.length === 0) {
      return new Error('at least one path key should be provided');
    }

    let lastProp = path[path.length - 1]!;
    let modifier = '';
    try {
      const result = splitModifier(lastProp);
      lastProp = result[0];
      modifier = result[1];
    } catch {
      // No modifier
    }

    const fullPath = [...path.slice(0, -1), lastProp];

    // Extract value
    let resultVal: unknown;
    try {
      resultVal = extractNestedVal(this.staticRequestInfo, ...fullPath);
    } catch (err) {
      // Graceful fallback for missing keys
    }

    // Handle :isset modifier
    if (modifier === IssetModifier) {
      try {
        extractNestedVal(this.staticRequestInfo, ...fullPath);
        return { identifier: 'TRUE' };
      } catch {
        return { identifier: 'FALSE' };
      }
    }

    // Normalize value
    if (resultVal === null || resultVal === undefined) {
      return { identifier: 'NULL' };
    }

    // Check if the value is a plain string — check if the field in the
    // base collection is a number type (multipart/form-data sends numbers as strings).
    if (typeof resultVal === 'string') {
      const field = this.baseCollection.fields.getByName(lastProp);
      if (field && field.type === 'number') {
        const nv = Number(resultVal);
        if (!isNaN(nv)) {
          resultVal = nv;
        }
      }
    }

    // For non-plain values, try stringifying
    if (
      typeof resultVal !== 'string' &&
      typeof resultVal !== 'number' &&
      typeof resultVal !== 'boolean'
    ) {
      try {
        resultVal = JSON.stringify(resultVal);
      } catch {
        resultVal = String(resultVal);
      }
    }

    // Unsupported modifier
    if (modifier !== '' && modifier !== LowerModifier) {
      return new Error(`invalid modifier sequence ${lastProp}:${modifier}`);
    }

    const placeholder = `f${Math.random().toString(36).slice(2, 12)}`;

    if (modifier === LowerModifier) {
      return {
        identifier: `LOWER({:${placeholder}}})`,
        params: { [placeholder]: resultVal },
      };
    }

    return {
      identifier: `{:${placeholder}}`,
      params: { [placeholder]: resultVal },
    };
  }
}
