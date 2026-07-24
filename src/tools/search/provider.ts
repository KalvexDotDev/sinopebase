/**
 * Search provider — parses URL query params, applies filters/sorting/pagination.
 *
 * Port of PocketBase tools/search/provider.go (MIT license).
 * Adapted for Kysely/PostgreSQL.
 * Layer 1 -- imports Layer 0 (~/tools/...).
 */

import type { FieldResolver } from "./simple_field_resolver";
import type { FilterData } from "./filter";
import { buildFilterExpr } from "./filter";
import { MAX_FILTER_LENGTH } from "./filter";
import type { SortField } from "./sort";
import { buildSortExpr } from "./sort";
import { parseSort } from "./sort";
import { Columnify } from "~/tools/inflector/inflector";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_PER_PAGE = 30;
export const DEFAULT_FILTER_EXPR_LIMIT = 200;
export const DEFAULT_SORT_EXPR_LIMIT = 8;
export const MAX_PER_PAGE = 1000;
export const MAX_SORT_FIELD_LENGTH = 255;

// URL query param names
export const PAGE_QUERY_PARAM = "page";
export const PER_PAGE_QUERY_PARAM = "perPage";
export const SORT_QUERY_PARAM = "sort";
export const FILTER_QUERY_PARAM = "filter";
export const SKIP_TOTAL_QUERY_PARAM = "skipTotal";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class SearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchError";
  }
}

export class EmptyQueryError extends SearchError {
  constructor() {
    super("search query is not set");
    this.name = "EmptyQueryError";
  }
}

export class SortExprLimitError extends SearchError {
  constructor() {
    super("max sort expressions limit reached");
    this.name = "SortExprLimitError";
  }
}

export class SortFieldLengthLimitError extends SearchError {
  constructor() {
    super("max sort field length limit reached");
    this.name = "SortFieldLengthLimitError";
  }
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

/**
 * Search result structure.
 */
export interface SearchResult<T> {
  items: T[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// SQL fragment types for Kysely integration
// ---------------------------------------------------------------------------

/**
 * Represents a built SQL WHERE clause fragment.
 */
export interface WhereClause {
  sql: string;
  params: unknown[];
}

/**
 * Represents a built SQL ORDER BY fragment.
 */
export interface OrderByClause {
  sql: string;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Search provider for executing paginated, filtered, and sorted queries.
 *
 * @example
 * ```typescript
 * const provider = new Provider(fieldResolver);
 * const result = provider.parseAndExec(
 *   "page=1&perPage=20&filter=status='active'&sort=-created",
 *   async (where, orderBy, limit, offset) => {
 *     // Execute query with the generated SQL fragments
 *   },
 *   async (where) => {
 *     // Execute count query
 *   },
 * );
 * ```
 */
export class Provider {
  fieldResolver: FieldResolver;
  query: unknown = null;
  countCol = "id";
  sort: SortField[] = [];
  filter: FilterData[] = [];
  page = 1;
  perPage = DEFAULT_PER_PAGE;
  skipTotal = false;
  maxFilterExprLimit = DEFAULT_FILTER_EXPR_LIMIT;
  maxSortExprLimit = DEFAULT_SORT_EXPR_LIMIT;

  constructor(fieldResolver: FieldResolver) {
    this.fieldResolver = fieldResolver;
  }

  // -----------------------------------------------------------------------
  // Fluent configuration
  // -----------------------------------------------------------------------

  setMaxFilterExprLimit(max: number): this {
    this.maxFilterExprLimit = max;
    return this;
  }

  setMaxSortExprLimit(max: number): this {
    this.maxSortExprLimit = max;
    return this;
  }

  setQuery(query: unknown): this {
    this.query = query;
    return this;
  }

  setSkipTotal(skipTotal: boolean): this {
    this.skipTotal = skipTotal;
    return this;
  }

  setCountCol(name: string): this {
    this.countCol = name;
    return this;
  }

  setPage(page: number): this {
    this.page = page;
    return this;
  }

  setPerPage(perPage: number): this {
    this.perPage = perPage;
    return this;
  }

  setSort(sort: SortField[]): this {
    this.sort = sort;
    return this;
  }

  addSort(field: SortField): this {
    this.sort.push(field);
    return this;
  }

  setFilter(filter: FilterData[]): this {
    this.filter = filter;
    return this;
  }

  addFilter(filter: FilterData): this {
    if (filter !== "") {
      this.filter.push(filter);
    }
    return this;
  }

  // -----------------------------------------------------------------------
  // Parse URL query string
  // -----------------------------------------------------------------------

  /**
   * Parses the search query parameters from the provided URL query string.
   *
   * Data from "sort" and "filter" params are appended to existing values.
   */
  parse(urlQuery: string): void {
    const params = new URLSearchParams(urlQuery);

    // SkipTotal
    const skipTotalRaw = params.get(SKIP_TOTAL_QUERY_PARAM);
    if (skipTotalRaw !== null) {
      const v = skipTotalRaw.toLowerCase();
      if (v === "true" || v === "1") {
        this.setSkipTotal(true);
      } else if (v === "false" || v === "0") {
        this.setSkipTotal(false);
      }
    }

    // Page
    const pageRaw = params.get(PAGE_QUERY_PARAM);
    if (pageRaw !== null) {
      const v = Number(pageRaw);
      if (!Number.isNaN(v) && Number.isInteger(v)) {
        this.setPage(v);
      }
    }

    // PerPage
    const perPageRaw = params.get(PER_PAGE_QUERY_PARAM);
    if (perPageRaw !== null) {
      const v = Number(perPageRaw);
      if (!Number.isNaN(v) && Number.isInteger(v)) {
        this.setPerPage(v);
      }
    }

    // Sort
    const sortRaw = params.get(SORT_QUERY_PARAM);
    if (sortRaw !== null) {
      const fields = parseSort(sortRaw);
      for (const field of fields) {
        this.addSort(field);
      }
    }

    // Filter
    const filterRaw = params.get(FILTER_QUERY_PARAM);
    if (filterRaw !== null) {
      this.addFilter(filterRaw);
    }
  }

  // -----------------------------------------------------------------------
  // Build WHERE clause
  // -----------------------------------------------------------------------

  /**
   * Builds the WHERE clause SQL from the provider's filter expressions.
   */
  buildWhere(): WhereClause {
    const allSQL: string[] = [];
    const allParams: unknown[] = [];

    for (const f of this.filter) {
      if (f.length > MAX_FILTER_LENGTH) {
        throw new Error("max filter length limit reached");
      }
      const result = buildFilterExpr(f, this.fieldResolver, undefined, this.maxFilterExprLimit);
      if (result.sql) {
        allSQL.push(result.sql);
        allParams.push(...result.values);
      }
    }

    return {
      sql: allSQL.length > 0 ? allSQL.join(" AND ") : "",
      params: allParams,
    };
  }

  // -----------------------------------------------------------------------
  // Build ORDER BY clause
  // -----------------------------------------------------------------------

  /**
   * Builds the ORDER BY clause SQL from the provider's sort fields.
   *
   * @param firstFromTable - The first FROM table (for @rowid resolution).
   */
  buildOrderBy(firstFromTable?: string): OrderByClause[] {
    if (this.sort.length > this.maxSortExprLimit) {
      throw new SortExprLimitError();
    }

    const clauses: OrderByClause[] = [];

    for (const sortField of this.sort) {
      if (sortField.name.length > MAX_SORT_FIELD_LENGTH) {
        throw new SortFieldLengthLimitError();
      }

      let expr: string;
      try {
        expr = buildSortExpr(sortField, this.fieldResolver);
      } catch (err) {
        throw new Error(
          `invalid sort field "${sortField.name}": ${(err as Error).message}`,
        );
      }

      // Ensure _rowid_ (ctid) expressions are prefixed with the first FROM table
      if (
        sortField.name === "@rowid" &&
        !expr.includes(".") &&
        firstFromTable
      ) {
        expr = `"${Columnify(firstFromTable)}".${expr}`;
      }

      if (expr) {
        clauses.push({ sql: expr });
      }
    }

    return clauses;
  }

  // -----------------------------------------------------------------------
  // Execute
  // -----------------------------------------------------------------------

  /**
   * Executes the search and returns a structured result.
   *
   * @param execModels - Callback that executes the data query.
   *   Receives WHERE SQL, ORDER BY clauses, limit, and offset.
   * @param execCount  - Callback that executes the count query.
   *   Receives WHERE SQL. Only called if skipTotal is false.
   */
  async exec<T>(
    execModels: (
      where: WhereClause,
      orderBy: OrderByClause[],
      limit: number,
      offset: number,
    ) => Promise<T[]>,
    execCount?: (where: WhereClause) => Promise<number>,
  ): Promise<SearchResult<T>> {
    if (!this.query) {
      throw new EmptyQueryError();
    }

    // Normalize page
    if (this.page <= 0) {
      this.page = 1;
    }

    // Normalize perPage
    if (this.perPage <= 0) {
      this.perPage = DEFAULT_PER_PAGE;
    } else if (this.perPage > MAX_PER_PAGE) {
      this.perPage = MAX_PER_PAGE;
    }

    // Build WHERE clause
    const where = this.buildWhere();

    // Build ORDER BY clause
    const orderBy = this.buildOrderBy();

    // Allow field resolver to modify query
    this.fieldResolver.updateQuery(this.query);

    // Variables for results
    let totalCount = -1;
    let totalPages = -1;

    // Execute count query
    const countPromise = (async () => {
      if (this.skipTotal || !execCount) return;
      totalCount = await execCount(where);
      totalPages = Math.ceil(totalCount / this.perPage);
    })();

    // Execute models query
    const modelsPromise = (async (): Promise<T[]> => {
      const limit = this.perPage;
      const offset = this.perPage * (this.page - 1);
      return execModels(where, orderBy, limit, offset);
    })();

    // Wait for both
    const [items] = await Promise.all([modelsPromise, countPromise]);

    const result: SearchResult<T> = {
      items,
      page: this.page,
      perPage: this.perPage,
      totalItems: totalCount,
      totalPages,
    };

    return result;
  }

  // -----------------------------------------------------------------------
  // Parse and exec shortcut
  // -----------------------------------------------------------------------

  /**
   * Shortcut to call both `parse()` and `exec()` in a single call.
   */
  async parseAndExec<T>(
    urlQuery: string,
    execModels: (
      where: WhereClause,
      orderBy: OrderByClause[],
      limit: number,
      offset: number,
    ) => Promise<T[]>,
    execCount?: (where: WhereClause) => Promise<number>,
  ): Promise<SearchResult<T>> {
    this.parse(urlQuery);
    return this.exec(execModels, execCount);
  }
}
