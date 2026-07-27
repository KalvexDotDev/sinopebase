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
import type { PostgrestClient } from './database'
import type { FunctionsClient } from './functions'
import type { RealtimeClient } from './realtime'
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
  from<T extends Record<string, unknown> = Record<string, unknown>>(
    table: string,
  ): PostgrestClient<T>

  /** Auth client (Supabase GoTrue-compatible) */
  auth: AuthClient

  /** Storage client (Supabase Storage-compatible) */
  storage: StorageClient

  /** Realtime client (Supabase Realtime-compatible) */
  realtime: RealtimeClient

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
export function createClient(url: string, key: string): SinopebaseClient {
  return new SinopebaseClientImpl(url, key)
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

  constructor(url: string, key: string) {
    this.supabaseUrl = url.replace(/\/$/, '')
    this.supabaseKey = key

    this.auth = createAuthClient(this.supabaseUrl, this.supabaseKey)
    this.storage = createStorageClient(this.supabaseUrl, this.supabaseKey)
    this.realtime = createRealtimeClient(this.supabaseUrl, this.supabaseKey)
    this.functions = createFunctionsClient(this.supabaseUrl, this.supabaseKey)
  }

  from<T extends Record<string, unknown> = Record<string, unknown>>(
    table: string,
  ): PostgrestClient<T> {
    return createPostgrestClient<T>(this.supabaseUrl, this.supabaseKey, table)
  }
}

// ---------------------------------------------------------------------------
// Sub-client factories — real HTTP calls hit the backend
// ---------------------------------------------------------------------------

import { createAuthClient } from './auth-impl'
import { createPostgrestClient } from './database'
import { createFunctionsClient } from './functions'
import { createRealtimeClient } from './realtime-impl'
import { createStorageClient } from './storage-impl'
