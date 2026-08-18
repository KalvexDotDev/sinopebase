/**
 * Sinopebase SDK — Server-Side Rendering helpers for SvelteKit.
 *
 * Provides createServerClient and createBrowserClient for cookie-based
 * session management during SSR, mirroring the @supabase/ssr API surface.
 * Users drop `sinopebase` in place of `@supabase/ssr` and point it at a
 * Sinopebase backend.
 *
 * @example
 * ```ts
 * // hooks.server.ts
 * import { createServerClient } from '@sinopebase/sdk'
 *
 * export const handle = async ({ event, resolve }) => {
 *   event.locals.sinopebase = createServerClient(
 *     'http://localhost:8090',
 *     'your-anon-key',
 *     { cookies: event.cookies },
 *   )
 *   return resolve(event)
 * }
 * ```
 *
 * Composable design: the functions live alongside the main client so users
 * import from a single package. If the package is split later, only the import
 * path changes — e.g. from '@sinopebase/sdk' to '@sinopebase/sdk/ssr'.
 */

import type { SinopebaseClient } from './client'
import { createClient } from './client'

/**
 * Cookie provider interface matching SvelteKit's cookies API.
 *
 * `getAll()` returns all cookies as name/value pairs.
 * `setAll()` writes a batch of cookies (used after token refresh).
 */
export interface CookieProvider {
  getAll(): { name: string; value: string }[]
  setAll(cookies: { name: string; value: string; options?: Record<string, unknown> }[]): void
}

/**
 * Create a Sinopebase client for server-side use (SvelteKit hooks.server.ts,
 * load functions, actions).
 *
 * The cookie provider forwards the session cookie on auth requests and
 * persists set-cookie responses, so sign-in and getSession() work through
 * the better-auth session cookie. Database queries and RPC resolve the
 * session token from the cookie on first use.
 */
export function createServerClient(
  url: string,
  key: string,
  options?: { cookies?: CookieProvider },
): SinopebaseClient {
  return createClient(url, key, options)
}

/**
 * Create a Sinopebase client for browser use.
 *
 * Identical to createClient(). The browser attaches cookies to requests
 * automatically, so no cookie adapter is needed. Provided for API symmetry
 * with supabase-js and to make the import path clear when splitting into
 * sub-packages.
 */
export function createBrowserClient(url: string, key: string): SinopebaseClient {
  return createClient(url, key)
}
