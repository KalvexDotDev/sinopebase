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
  setAll(cookies: { name: string; value: string; opts?: Record<string, unknown> }[]): void
}

/**
 * Create a Sinopebase client for server-side use (SvelteKit hooks.server.ts,
 * load functions, actions).
 *
 * The returned client is identical to createClient() — the cookie provider is
 * accepted for API compatibility with @supabase/ssr and is the seam where
 * cookie forwarding gets wired in: getAll() builds the Cookie header on auth
 * requests and setAll() persists set-cookie responses. The backend auth
 * endpoints are already cookie-aware (GET /auth/v1/session reads the
 * better-auth session cookie); the client-side forwarding is a follow-up.
 */
export function createServerClient(
  url: string,
  key: string,
  _options?: { cookies?: CookieProvider },
): SinopebaseClient {
  return createClient(url, key)
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
