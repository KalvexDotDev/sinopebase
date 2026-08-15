/**
 * PostgREST Database Client
 *
 * Mirrors @supabase/postgrest-js query builder.
 * Translates method chains to Sinopebase /rest/v1 HTTP requests.
 *
 * Port of: PocketBase apis/record_crud.go + tools/search/
 * Backend: core/record_query.go, core/collection_query.go
 */

import type { PostgrestError, PostgrestResponse, PostgrestSingleResponse } from './client'

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------

/** JSON-safe value — RPC arguments must serialize to JSON. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export interface RpcOptions {
  /** Skip body parsing — return status only (supabase-js `head`). */
  head?: boolean
  /** Return a single value instead of a row array (supabase-js `get`). */
  get?: boolean
}

// Table names are one path segment — rejects traversal out of /rest/v1/.
const TABLE_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'like'
  | 'ilike'
  | 'is'
  | 'in'
// Note: cs, cd, sl, sr, nxl, nxr, adj, ov operators are deferred to v0.7.
// Note: fts, plfts, phfts, wfts full-text search operators are deferred to v0.8+.

export interface PostgrestClient<T extends Record<string, unknown>> {
  // Select
  select(
    columns?: string,
    options?: { head?: boolean; count?: 'exact' | 'planned' | 'estimated' },
  ): PostgrestFilterBuilder<T>

  // Mutations
  insert(
    values: Partial<T> | Partial<T>[],
    options?: { upsert?: boolean },
  ): PostgrestFilterBuilder<T>
  update(values: Partial<T>): PostgrestFilterBuilder<T>
  delete(): PostgrestFilterBuilder<T>

  // RPC — supabase-js contract: rows by default, single value with `get: true`
  rpc<T = Record<string, JsonValue>>(
    fn: string,
    args?: Record<string, JsonValue>,
    options?: RpcOptions & { get?: false },
  ): PromiseLike<PostgrestResponse<T[]>>
  rpc<T = Record<string, JsonValue>>(
    fn: string,
    args: Record<string, JsonValue> | undefined,
    options: RpcOptions & { get: true },
  ): PromiseLike<PostgrestSingleResponse<T>>
}

export interface PostgrestFilterBuilder<T extends Record<string, unknown>> {
  // Filters
  eq(column: string, value: unknown): this
  neq(column: string, value: unknown): this
  gt(column: string, value: unknown): this
  gte(column: string, value: unknown): this
  lt(column: string, value: unknown): this
  lte(column: string, value: unknown): this
  like(column: string, pattern: string): this
  ilike(column: string, pattern: string): this
  is(column: string, value: null | boolean): this
  in(column: string, values: unknown[]): this
  contains(column: string, value: unknown): this
  containedBy(column: string, value: unknown): this
  or(filters: string): this
  not(column: string, operator: string, value: unknown): this
  textSearch(column: string, query: string, options?: { type?: string; config?: string }): this

  // Modify return shape (for mutations: tells backend to return the modified rows)
  select(columns?: string): this

  // Transforms
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): this
  limit(count: number): this
  range(from: number, to: number): this
  offset(count: number): this
  single(): PromiseLike<{ data: T | null; error: PostgrestError | null }>
  maybeSingle(): PromiseLike<{ data: T | null; error: PostgrestError | null }>

  // Execute (thenable — can be awaited directly)
  then<TResult1 = PostgrestResponse<T[]>, TResult2 = never>(
    onfulfilled?: ((value: PostgrestResponse<T[]>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createPostgrestClient<T extends Record<string, unknown>>(
  baseUrl: string,
  apiKey: string,
  table: string,
  getAccessToken: () => Promise<string | null> = async () => null,
): PostgrestClient<T> {
  return new PostgrestClientImpl<T>(baseUrl, apiKey, table, getAccessToken)
}

class PostgrestClientImpl<T extends Record<string, unknown>> implements PostgrestClient<T> {
  private baseUrl: string
  private apiKey: string
  private table: string
  private getAccessToken: () => Promise<string | null>

  constructor(
    baseUrl: string,
    apiKey: string,
    table: string,
    getAccessToken: () => Promise<string | null>,
  ) {
    this.baseUrl = baseUrl
    this.apiKey = apiKey
    this.table = table
    this.getAccessToken = getAccessToken
  }

  select(columns = '*', options = {}): PostgrestFilterBuilder<T> {
    return new PostgrestFilterBuilderImpl<T>(
      this.baseUrl,
      this.apiKey,
      this.table,
      'GET',
      undefined,
      columns,
      options,
      this.getAccessToken,
    )
  }

  insert(values: Partial<T> | Partial<T>[], options = {}): PostgrestFilterBuilder<T> {
    return new PostgrestFilterBuilderImpl<T>(
      this.baseUrl,
      this.apiKey,
      this.table,
      'POST',
      values,
      '*',
      options as Record<string, unknown>,
      this.getAccessToken,
    )
  }

  update(values: Partial<T>): PostgrestFilterBuilder<T> {
    return new PostgrestFilterBuilderImpl<T>(
      this.baseUrl,
      this.apiKey,
      this.table,
      'PATCH',
      values,
      '*',
      {},
      this.getAccessToken,
    )
  }

  delete(): PostgrestFilterBuilder<T> {
    return new PostgrestFilterBuilderImpl<T>(
      this.baseUrl,
      this.apiKey,
      this.table,
      'DELETE',
      undefined,
      undefined,
      {},
      this.getAccessToken,
    )
  }

  rpc<T = Record<string, JsonValue>>(
    fn: string,
    args?: Record<string, JsonValue>,
    options?: RpcOptions & { get?: false },
  ): Promise<PostgrestResponse<T[]>>
  rpc<T = Record<string, JsonValue>>(
    fn: string,
    args: Record<string, JsonValue> | undefined,
    options: RpcOptions & { get: true },
  ): Promise<PostgrestSingleResponse<T>>
  rpc<T = Record<string, JsonValue>>(
    fn: string,
    args?: Record<string, JsonValue>,
    options?: RpcOptions,
  ): Promise<PostgrestResponse<T[]> | PostgrestSingleResponse<T>> {
    return postgrestRpc(this.baseUrl, this.apiKey, this.getAccessToken, fn, args, options)
  }
}

// ---------------------------------------------------------------------------
// RPC — shared by SinopebaseClient.rpc and PostgrestClient.rpc
// ---------------------------------------------------------------------------

/**
 * Execute a PostgreSQL function (supabase-js `rpc()` contract).
 *
 * Default: rows as an array. `{ get: true }`: a single value. `{ head: true }`:
 * status only. Sends the current session token when signed in, otherwise the
 * API key, so the backend resolves the correct RLS role.
 */
export async function postgrestRpc<T = Record<string, JsonValue>>(
  baseUrl: string,
  apiKey: string,
  getAccessToken: () => Promise<string | null>,
  fn: string,
  args?: Record<string, JsonValue>,
  options: RpcOptions = {},
): Promise<PostgrestResponse<T[]> | PostgrestSingleResponse<T>> {
  const token = (await getAccessToken()) ?? apiKey
  try {
    const res = await fetch(`${baseUrl}/rest/v1/rpc/${encodeURIComponent(fn)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(args ?? {}),
    })

    if (options.head) {
      return {
        data: null,
        error: res.ok
          ? null
          : { message: res.statusText, details: '', hint: '', code: String(res.status) },
        count: null,
        status: res.status,
        statusText: res.statusText,
      }
    }

    // Network boundary — the response shape is unknown until checked.
    const body: unknown = await res.json().catch(() => null)

    if (!res.ok) {
      return {
        data: null,
        error: {
          message: readErrorField(body, 'message') ?? res.statusText,
          details: readErrorField(body, 'details') ?? '',
          hint: readErrorField(body, 'hint') ?? '',
          code: readErrorField(body, 'code') ?? String(res.status),
        },
        count: null,
        status: res.status,
        statusText: res.statusText,
      }
    }

    if (options.get) {
      // PostgREST contract: a scalar was requested — zero or multiple rows
      // is an error (406 PGRST116), never a silent array.
      if (Array.isArray(body) && body.length !== 1) {
        return {
          data: null,
          error: {
            message: 'JSON object requested, multiple (or no) rows returned',
            details: '',
            hint: '',
            code: 'PGRST116',
          },
        }
      }
      return { data: unwrapScalar(body) as T, error: null }
    }

    const rows: unknown[] = Array.isArray(body) ? body : body === null ? [] : [body]
    return {
      data: rows as T[],
      error: null,
      count: null,
      status: res.status,
      statusText: res.statusText,
    }
  } catch (err) {
    return {
      data: null,
      error: {
        message: err instanceof Error ? err.message : 'Unknown error',
        details: '',
        hint: '',
        code: 'NETWORK_ERROR',
      },
      count: null,
      status: 0,
      statusText: 'Network Error',
    }
  }
}

function readErrorField(body: unknown, key: string): string | null {
  if (typeof body !== 'object' || body === null) return null
  const value = (body as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : null
}

// ponytail: scalar functions arrive as `[{<fn>: value}]` through the rows
// transport. Unwrap to match PostgREST's scalar responses. A single-row
// single-column SETOF result is indistinguishable — use the default form
// (no `get`) when the row itself is wanted.
function unwrapScalar(body: unknown): unknown {
  if (Array.isArray(body) && body.length === 1) {
    const row = body[0]
    if (typeof row === 'object' && row !== null) {
      const values = Object.values(row)
      if (values.length === 1) return values[0]
    }
  }
  return body
}

class PostgrestFilterBuilderImpl<T extends Record<string, unknown>>
  implements PostgrestFilterBuilder<T>
{
  private baseUrl: string
  private apiKey: string
  private table: string
  private method: string
  private body: unknown
  private columns?: string
  private options: Record<string, unknown>
  private filters: string[] = []
  private orderParams: string[] = []
  private limitParam?: number
  private offsetParam?: number
  private rangeParam?: { from: number; to: number }
  private wantMaybeSingle = false
  private getAccessToken: () => Promise<string | null>

  constructor(
    baseUrl: string,
    apiKey: string,
    table: string,
    method: string,
    body: unknown,
    columns?: string,
    options: Record<string, unknown> = {},
    getAccessToken: () => Promise<string | null> = async () => null,
  ) {
    this.baseUrl = baseUrl
    this.apiKey = apiKey
    this.table = table
    this.method = method
    this.body = body
    this.columns = columns
    this.options = options
    this.getAccessToken = getAccessToken
  }

  // Filters — values are stored raw; URLSearchParams encodes them exactly
  // once when the query string is built (pre-encoding here double-encoded
  // JSON, wildcards, and multi-word queries).
  eq(column: string, value: unknown): this {
    this.filters.push(`${column}=eq.${String(value)}`)
    return this
  }
  neq(column: string, value: unknown): this {
    this.filters.push(`${column}=neq.${String(value)}`)
    return this
  }
  gt(column: string, value: unknown): this {
    this.filters.push(`${column}=gt.${String(value)}`)
    return this
  }
  gte(column: string, value: unknown): this {
    this.filters.push(`${column}=gte.${String(value)}`)
    return this
  }
  lt(column: string, value: unknown): this {
    this.filters.push(`${column}=lt.${String(value)}`)
    return this
  }
  lte(column: string, value: unknown): this {
    this.filters.push(`${column}=lte.${String(value)}`)
    return this
  }
  like(column: string, pattern: string): this {
    this.filters.push(`${column}=like.${pattern}`)
    return this
  }
  ilike(column: string, pattern: string): this {
    this.filters.push(`${column}=ilike.${pattern}`)
    return this
  }
  is(column: string, value: null | boolean): this {
    this.filters.push(`${column}=is.${value === null ? 'null' : String(value)}`)
    return this
  }
  in(column: string, values: unknown[]): this {
    this.filters.push(
      `${column}=in.(${values
        .map((v) => {
          const s = String(v)
          // Values containing commas must be double-quoted so PostgREST
          // treats them as a single value rather than splitting on the comma.
          return s.includes(',') ? `"${s}"` : s
        })
        .join(',')})`,
    )
    return this
  }
  contains(column: string, value: unknown): this {
    this.filters.push(`${column}=cs.${JSON.stringify(value)}`)
    return this
  }
  or(filters: string): this {
    this.filters.push(`or=(${filters})`)
    return this
  }
  not(column: string, operator: string, value: unknown): this {
    this.filters.push(`${column}=not.${operator}.${String(value)}`)
    return this
  }
  textSearch(column: string, query: string, options?: { type?: string; config?: string }): this {
    const type = options?.type ?? 'fts'
    this.filters.push(`${column}=${type}.${query}`)
    return this
  }
  containedBy(column: string, value: unknown): this {
    this.filters.push(`${column}=cd.${JSON.stringify(value)}`)
    return this
  }

  // Modify return shape
  select(columns = '*'): this {
    this.columns = columns
    return this
  }

  // Transforms (implementation)
  order(
    column: string,
    options: { ascending?: boolean; nullsFirst?: boolean } = { ascending: true },
  ): this {
    this.orderParams.push(
      `${column}.${options.ascending !== false ? 'asc' : 'desc'}${options.nullsFirst ? '.nullsfirst' : ''}`,
    )
    return this
  }
  limit(count: number): this {
    this.limitParam = count
    return this
  }
  offset(count: number): this {
    this.offsetParam = count
    return this
  }
  range(from: number, to: number): this {
    this.rangeParam = { from, to }
    return this
  }
  single(): PromiseLike<{ data: T | null; error: PostgrestError | null }> {
    this.wantMaybeSingle = false // force error on 0 rows and >1 rows
    return this.executeSingle()
  }
  maybeSingle(): PromiseLike<{ data: T | null; error: PostgrestError | null }> {
    this.wantMaybeSingle = true
    return this.executeSingle()
  }

  // Thenable — await the query directly (intentional, same pattern as Kysely)
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable pattern for await support
  then<TResult1 = PostgrestResponse<T[]>, TResult2 = never>(
    onfulfilled?: ((value: PostgrestResponse<T[]>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected)
  }

  // -----------------------------------------------------------------------
  // Internal — build and execute HTTP request
  // -----------------------------------------------------------------------

  private async execute(): Promise<PostgrestResponse<T[]>> {
    try {
      // Trust boundary: the session token is attached to these requests, so a
      // hostile table name must not be able to retarget them at other routes.
      if (!TABLE_NAME.test(this.table)) {
        return {
          data: null,
          error: {
            message: `Invalid table name "${this.table}"`,
            details: '',
            hint: '',
            code: 'INVALID_TABLE',
          },
          count: null,
          status: 0,
          statusText: 'Invalid Table Name',
        }
      }

      let url = `${this.baseUrl}/rest/v1/${this.table}`

      // Build query string
      const params = new URLSearchParams()
      if (this.columns && this.columns !== '*' && this.method === 'GET') {
        params.set('select', this.columns)
      }
      for (const filter of this.filters) {
        const [key, ...vals] = filter.split('=')
        if (key === undefined) continue
        params.append(key, vals.join('='))
      }
      if (this.orderParams.length) params.set('order', this.orderParams.join(','))
      if (this.limitParam !== undefined) params.set('limit', String(this.limitParam))
      if (this.offsetParam !== undefined) params.set('offset', String(this.offsetParam))
      if (this.options.count) params.set('count', String(this.options.count))

      const qs = params.toString()
      if (qs) url += `?${qs}`

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        apikey: this.apiKey,
        // Session token wins over the API key so RLS resolves the signed-in user's role.
        Authorization: `Bearer ${(await this.getAccessToken()) ?? this.apiKey}`,
      }

      if (this.options.count) {
        headers.Prefer = `count=${this.options.count}`
      }
      if (this.body && (this.method === 'POST' || this.method === 'PATCH')) {
        headers.Prefer = `${headers.Prefer ?? ''},return=representation`
      }
      if ((this.options as Record<string, unknown>).upsert) {
        headers.Prefer = `${headers.Prefer ?? ''},resolution=merge-duplicates`
      }

      if (this.rangeParam) {
        headers.Range = `${this.rangeParam.from}-${this.rangeParam.to}`
      }
      if (this.options.head) {
        this.method = 'HEAD'
      }

      const res = await fetch(url, {
        method: this.method,
        headers,
        body: this.body ? JSON.stringify(this.body) : undefined,
      })

      const countHeader = res.headers.get('content-range')
      const count = countHeader ? parseInt(countHeader.split('/')[1] ?? '0', 10) : null

      if (this.method === 'HEAD') {
        return { data: null, error: null, count, status: res.status, statusText: res.statusText }
      }

      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null

      if (!res.ok) {
        return {
          data: null,
          error: {
            message: (json?.message as string) ?? res.statusText,
            details: (json?.details as string) ?? '',
            hint: (json?.hint as string) ?? '',
            code: (json?.code as string) ?? String(res.status),
          },
          count: null,
          status: res.status,
          statusText: res.statusText,
        }
      }

      return {
        data: json as unknown as T[],
        error: null,
        count,
        status: res.status,
        statusText: res.statusText,
      }
    } catch (err) {
      return {
        data: null,
        error: {
          message: err instanceof Error ? err.message : 'Unknown error',
          details: '',
          hint: '',
          code: 'NETWORK_ERROR',
        },
        count: null,
        status: 0,
        statusText: 'Network Error',
      }
    }
  }

  private async executeSingle(): Promise<{ data: T | null; error: PostgrestError | null }> {
    const result = await this.execute()
    if (result.error) {
      return { data: null, error: result.error }
    }
    if (!result.data || result.data.length === 0) {
      if (this.wantMaybeSingle) {
        return { data: null, error: null }
      }
      return {
        data: null,
        error: { message: 'No rows found', details: '', hint: '', code: 'PGRST116' },
      }
    }
    if (result.data.length > 1) {
      return {
        data: null,
        error: { message: 'Multiple rows found', details: '', hint: '', code: 'PGRST116' },
      }
    }
    return { data: result.data[0] ?? null, error: null }
  }
}
