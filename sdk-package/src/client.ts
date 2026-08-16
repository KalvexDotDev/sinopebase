/**
 * Sinopebase SDK — Thin Supabase-compatible Client
 *
 * Mirrors the supabase-js API surface. Users drop in `sinopebase`
 * in place of `@supabase/supabase-js` and point it at a Sinopebase backend.
 *
 * All methods delegate to the Sinopebase REST API (/rest/v1, /auth/v1, etc.)
 * and return supabase-js compatible response shapes.
 */

import type { AuthClient } from './auth'
import type { JsonValue, PostgrestClient, RpcOptions } from './database'
import type { FunctionsClient } from './functions'
import type { RealtimeChannel, RealtimeClient } from './realtime'
import type { CookieProvider } from './ssr'
import type { StorageClient } from './storage'

// ---------------------------------------------------------------------------
// Response types — mirror supabase-js
// ---------------------------------------------------------------------------

export interface PostgrestResponse<T> {
  data: T | null
  error: PostgrestError | null
  count: number | null
  status: number
  statusText: string
}

export interface PostgrestError {
  message: string
  details: string
  hint: string
  code: string
}

export interface PostgrestSingleResponse<T> {
  data: T | null
  error: PostgrestError | null
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface SinopebaseClient {
  /** PostgREST-compatible database client */
  from<T = any>(
    table: string,
  ): PostgrestClient<T>

  /**
   * Execute a PostgreSQL function — supabase-js `rpc()` contract.
   * Rows by default, a single value with `{ get: true }`, status only with
   * `{ head: true }`. Sends the signed-in session token when available so
   * RLS resolves the user's role.
   */
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

  /** Auth client (Supabase GoTrue-compatible) */
  auth: AuthClient

  /** Storage client (Supabase Storage-compatible) */
  storage: StorageClient

  /** Realtime client (Supabase Realtime-compatible) */
  realtime: RealtimeClient

  /** Supabase-js top-level convenience: open a realtime channel. */
  channel(topic: string, params?: { config?: Record<string, unknown> }): RealtimeChannel

  /** Supabase-js top-level convenience: remove a realtime channel. */
  removeChannel(channel: RealtimeChannel): void

  /** Edge Functions client (Supabase Functions-compatible) */
  functions: FunctionsClient

  /** Base URL of the connected backend */
  supabaseUrl: string

  /** API key in use */
  supabaseKey: string
}

/**
 * Create a Sinopebase client — drop-in replacement for supabase-js createClient().
 *
 * @example
 * ```ts
 * import { createClient } from 'sinopebase'
 * const sinopebase = createClient('http://localhost:8090', 'your-anon-key')
 * const { data } = await sinopebase.from('todos').select('*')
 * ```
 */
export function createClient(
  url: string,
  key: string,
  options?: {
    cookies?: CookieProvider
    auth?: { autoRefreshToken?: boolean; persistSession?: boolean; detectSessionInUrl?: boolean }
  },
): SinopebaseClient {
  // ponytail: `auth` options accepted for supabase-js parity, not yet honored.
  return new SinopebaseClientImpl(url, key, options?.cookies)
}

// ---------------------------------------------------------------------------
// Implementation — thin wrapper delegating to REST endpoints
// ---------------------------------------------------------------------------

class SinopebaseClientImpl implements SinopebaseClient {
  public readonly supabaseUrl: string
  public readonly supabaseKey: string

  public readonly auth: AuthClient
  public readonly storage: StorageClient
  public readonly realtime: RealtimeClient
  public readonly functions: FunctionsClient

  constructor(url: string, key: string, cookies?: CookieProvider) {
    this.supabaseUrl = url.replace(/\/$/, '')
    this.supabaseKey = key

    this.auth = createAuthClient(this.supabaseUrl, this.supabaseKey, cookies)
    this.storage = createStorageClient(this.supabaseUrl, this.supabaseKey)
    this.realtime = createRealtimeClient(this.supabaseUrl, this.supabaseKey)
    this.functions = createFunctionsClient(this.supabaseUrl, this.supabaseKey)

    // supabase-js parity: keep the realtime session token in sync with auth so
    // postgres_changes joins carry the user's access_token (RLS visibility).
    void this.auth.getAccessToken().then((token) => {
      if (token) this.realtime.setAuth(token)
    })
    this.auth.onAuthStateChange((_event, session) => {
      this.realtime.setAuth(session?.access_token ?? null)
    })
  }

  from<T = any>(
    table: string,
  ): PostgrestClient<T> {
    return createPostgrestClient<T>(this.supabaseUrl, this.supabaseKey, table, () =>
      this.auth.getAccessToken(),
    )
  }

  channel(topic: string, _params?: { config?: Record<string, unknown> }): RealtimeChannel {
    return this.realtime.channel(topic)
  }

  removeChannel(channel: RealtimeChannel): void {
    this.realtime.removeChannel(channel)
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
    return postgrestRpc(
      this.supabaseUrl,
      this.supabaseKey,
      () => this.auth.getAccessToken(),
      fn,
      args,
      options,
    )
  }
}

// ---------------------------------------------------------------------------
// Sub-client factories — real HTTP calls hit the backend
// ---------------------------------------------------------------------------

import { createAuthClient } from './auth-impl'
import { createPostgrestClient, postgrestRpc } from './database'
import { createFunctionsClient } from './functions'
import { createRealtimeClient } from './realtime-impl'
import { createStorageClient } from './storage-impl'

export type { CookieProvider } from './ssr'
export { createBrowserClient, createServerClient, isBrowser } from './ssr'
export type { RealtimeChannel, RealtimeClient } from './realtime'
export type { AuthError, Session, User } from './auth'
