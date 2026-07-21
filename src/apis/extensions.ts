/**
 * UI extensions API endpoint (for the admin UI plugin system).
 *
 * Port of PocketBase apis/extensions.go
 * Layer 4 — imports from ~/core/*, ~/tools/*.
 *
 * PocketBase allows external UI extensions to be registered at runtime.
 * Each extension provides:
 * - A name (used as the URL path segment)
 * - A virtual filesystem (fs.FS) with static assets (JS, CSS, HTML)
 * - A main.js entrypoint that is concatenated into a single /_/extensions.js file
 *
 * This module provides:
 * - `bindUIExtensions()` — registers extension routes on the ServeEvent
 * - `copyExtensionMainjs()` — concatenates all extension main.js files
 * - `UIExtension` interface
 */

import { Elysia } from 'elysia'
import type { App } from '~/core/app'
import { skipSuccessActivityLog, securityHeaders } from './middlewares'
import type { UIExtension } from '~/core/events'

// ---------------------------------------------------------------------------
// Default CSP (same as serve.ts)
// ---------------------------------------------------------------------------

const DEFAULT_CSP = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' http://127.0.0.1:* https://tile.openstreetmap.org data: blob:",
  "connect-src 'self' http://127.0.0.1:* https://nominatim.openstreetmap.org",
  "script-src 'self' http://127.0.0.1:*",
  "frame-ancestors 'none'",
].join('; ')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Adds cache-control and CSP headers to extension responses.
 */
function extensionHeaders(ctx: {
  request: Request
  set: { headers: Record<string, string> }
  params: Record<string, string>
}): void {
  // Don't cache the root index page, but cache static assets
  const path = ctx.params['path'] ?? ''
  if (path && !ctx.set.headers['cache-control']) {
    ctx.set.headers['cache-control'] =
      'max-age=1209600, stale-while-revalidate=86400'
  }

  if (!ctx.set.headers['content-security-policy']) {
    ctx.set.headers['content-security-policy'] = DEFAULT_CSP
  }
}

// ---------------------------------------------------------------------------
// bindUIExtensions
// ---------------------------------------------------------------------------

/**
 * Registers UI extension routes on the given Elysia app under the /_ prefix.
 *
 * Each registered extension gets:
 * - `/_/extensions/<name>/{path...}` — static file serving from the extension's FS
 * - `/_/extensions.js` — concatenated main.js from all extensions
 *
 * Call this after creating the router but before starting the server:
 * ```ts
 * bindUIExtensions(app, router, extensions)
 * ```
 *
 * @param app         The Sinopebase App instance.
 * @param router      The Elysia app instance.
 * @param extensions  Array of UIExtension to register.
 */
export function bindUIExtensions(
  app: App,
  router: Elysia,
  extensions: UIExtension[],
): void {
  if (extensions.length === 0) return

  const uiGroup = new Elysia({ prefix: '/_', name: 'ui-extensions' })

  // Apply headers to all extension routes
  uiGroup.onRequest(extensionHeaders)
  uiGroup.onRequest(securityHeaders())

  // Register static file routes for each extension
  for (const ext of extensions) {
    if (!ext.name) {
      app.logger()?.Write?.(-4, 'Invalid UI extension: missing name') // Debug
      continue
    }

    uiGroup.get(
      `/extensions/${ext.name}/{path*}`,
      async (ctx) => {
        const path = ctx.params['path*'] ?? 'index.html'

        try {
          // Attempt to read the file from the extension's filesystem
          // The `html` field is treated as inline content.
          // For real FS-backed extensions, read from ext.FS (not ported yet).
          if (path === 'main.js' && ext.html) {
            return new Response(ext.html, {
              headers: { 'content-type': 'text/javascript' },
            })
          }

          ctx.set.status = 404
          return { message: 'File not found in extension', code: 404 }
        } catch {
          ctx.set.status = 404
          return { message: 'File not found in extension', code: 404 }
        }
      },
    )
  }

  // Combined extensions.js endpoint
  uiGroup.get(
    '/extensions.js',
    async () => {
      const parts: string[] = []

      for (const ext of extensions) {
        const wrapped = copyExtensionMainjs(ext)
        if (wrapped) {
          parts.push(wrapped)
        }
      }

      return new Response(parts.join('\n'), {
        headers: { 'content-type': 'text/javascript' },
      })
    },
  )

  // Apply skipSuccessActivityLog to the extensions.js endpoint
  // (PocketBase does this to avoid flooding logs)
  uiGroup.onRequest(skipSuccessActivityLog())

  router.use(uiGroup)
}

// ---------------------------------------------------------------------------
// copyExtensionMainjs
// ---------------------------------------------------------------------------

/**
 * Wraps an extension's `html` content (treated as JS code) in a
 * self-executing async function to avoid scope and concatenation issues.
 *
 * Returns `null` if the extension has no content to contribute.
 */
export function copyExtensionMainjs(ext: UIExtension): string | null {
  if (!ext.html) return null

  // PocketBase wraps in an async IIFE to support top-level await
  return `await (async function(){${ext.html}})();`
}

// ---------------------------------------------------------------------------
// Default UI extensions (placeholder)
// ---------------------------------------------------------------------------

/**
 * Empty array of UI extensions.
 * Populate this at bootstrap time by reading from settings or plugins.
 */
export const defaultUIExtensions: UIExtension[] = []
