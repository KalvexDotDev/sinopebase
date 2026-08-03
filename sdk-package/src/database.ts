/**
 * PostgREST Database Client
 *
 * Mirrors @supabase/postgrest-js query builder.
 * Translates method chains to Sinopebase /rest/v1 HTTP requests.
 *
 * Port of: PocketBase apis/record_crud.go + tools/search/
 * Backend: core/record_query.go, core/collection_query.go
 */

import type { PostgrestError, PostgrestResponse } from './client'

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------

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
// Note: fts, plfts, phfts, wfts full-text search operators are deferred to v0.7.

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

  // RPC
  rpc<U = unknown>(fn: string, args?: Record<string, unknown>): PromiseLike<PostgrestResponse<U>>
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
  or(filters: string): this
  // not() operator deferred to v0.7 — server-side support not yet implemented

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
): PostgrestClient<T> {
  return new PostgrestClientImpl<T>(baseUrl, apiKey, table)
}

class PostgrestClientImpl<T extends Record<string, unknown>> implements PostgrestClient<T> {
  private baseUrl: string
  private apiKey: string
  private table: string

  constructor(baseUrl: string, apiKey: string, table: string) {
    this.baseUrl = baseUrl
    this.apiKey = apiKey
    this.table = table
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
    )
  }

  async rpc<U = unknown>(
    fn: string,
    args?: Record<string, unknown>,
  ): Promise<PostgrestResponse<U>> {
    const url = `${this.baseUrl}/rest/v1/rpc/${fn}`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: this.apiKey,
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(args ?? {}),
    })
    const body = await res.json().catch(() => null)
    return {
      data: body as U,
      error: null,
      count: null,
      status: res.status,
      statusText: res.statusText,
    }
  }
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
  private wantSingle = false
  private wantMaybeSingle = false

  constructor(
    baseUrl: string,
    apiKey: string,
    table: string,
    method: string,
    body: unknown,
    columns?: string,
    options: Record<string, unknown> = {},
  ) {
    this.baseUrl = baseUrl
    this.apiKey = apiKey
    this.table = table
    this.method = method
    this.body = body
    this.columns = columns
    this.options = options
  }

  // Filters
  eq(column: string, value: unknown): this {
    this.filters.push(`${column}=eq.${encodeURIComponent(String(value))}`)
    return this
  }
  neq(column: string, value: unknown): this {
    this.filters.push(`${column}=neq.${encodeURIComponent(String(value))}`)
    return this
  }
  gt(column: string, value: unknown): this {
    this.filters.push(`${column}=gt.${encodeURIComponent(String(value))}`)
    return this
  }
  gte(column: string, value: unknown): this {
    this.filters.push(`${column}=gte.${encodeURIComponent(String(value))}`)
    return this
  }
  lt(column: string, value: unknown): this {
    this.filters.push(`${column}=lt.${encodeURIComponent(String(value))}`)
    return this
  }
  lte(column: string, value: unknown): this {
    this.filters.push(`${column}=lte.${encodeURIComponent(String(value))}`)
    return this
  }
  like(column: string, pattern: string): this {
    this.filters.push(`${column}=like.${encodeURIComponent(pattern)}`)
    return this
  }
  ilike(column: string, pattern: string): this {
    this.filters.push(`${column}=ilike.${encodeURIComponent(pattern)}`)
    return this
  }
  is(column: string, value: null | boolean): this {
    this.filters.push(`${column}=is.${value === null ? 'null' : String(value)}`)
    return this
  }
  in(column: string, values: unknown[]): this {
    this.filters.push(
      `${column}=in.(${values.map((v) => encodeURIComponent(String(v))).join(',')})`,
    )
    return this
  }
  contains(column: string, value: unknown): this {
    this.filters.push(`${column}=cs.${encodeURIComponent(JSON.stringify(value))}`)
    return this
  }
  or(filters: string): this {
    this.filters.push(`or=(${encodeURIComponent(filters)})`)
    return this
  }
  // not() operator deferred to v0.7 — server-side support not yet implemented

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
    this.wantSingle = true
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
      let url = `${this.baseUrl}/rest/v1/${this.table}`

      // Build query string
      const params = new URLSearchParams()
      if (this.columns && this.columns !== '*' && this.method === 'GET') {
        params.set('select', this.columns)
      }
      for (const filter of this.filters) {
        const [key, ...vals] = filter.split('=')
        if (key === undefined) continue
        params.set(key, vals.join('='))
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
        Authorization: `Bearer ${this.apiKey}`,
      }

      if (this.options.count) {
        headers.Prefer = `count=${this.options.count}`
      }
      if (this.body && (this.method === 'POST' || this.method === 'PATCH')) {
        headers.Prefer = `${headers.Prefer ?? ''},return=representation`
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
    if (result.data.length > 1 && this.wantSingle) {
      return {
        data: null,
        error: { message: 'Multiple rows found', details: '', hint: '', code: 'PGRST116' },
      }
    }
    return { data: result.data[0] ?? null, error: null }
  }
}
