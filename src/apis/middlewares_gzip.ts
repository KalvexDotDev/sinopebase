/**
 * Gzip compression configuration for Elysia.
 *
 * Elysia has built-in compression via `app.use(compression())` from the
 * `@elysiajs/compress` plugin (or Elysia v1+ native support).
 *
 * This file documents the configuration that mirrors PocketBase's gzip
 * behaviour (port of apis/middlewares_gzip.go) and provides a small
 * convenience wrapper so the application can register compression with
 * the same semantics.
 *
 * PocketBase behaviour:
 * - Compression level: default gzip (-1)
 * - Only compresses when the client sends `Accept-Encoding: gzip`
 * - Adds `Vary: Accept-Encoding` header
 * - Respects a minimum body length threshold before compressing
 * - Delays writing the `Content-Encoding` header until it knows the
 *   body is large enough to benefit from compression
 */

export interface GzipConfig {
  /**
   * Gzip compression level.
   * -1 = default, 0 = no compression (store), 1-9 = speed vs size.
   * @default -1
   */
  level?: number

  /**
   * Minimum response body length (in bytes) before gzip is applied.
   * Responses smaller than this are sent uncompressed.
   * @default 0
   */
  minLength?: number
}

/**
 * Default gzip configuration matching PocketBase behaviour.
 */
export const DEFAULT_GZIP_CONFIG: GzipConfig = {
  level: -1,
  minLength: 0,
}

/**
 * Registers response compression on an Elysia app using the built-in
 * `@elysiajs/compress` plugin with PocketBase-compatible defaults.
 *
 * If you are using Elysia v1.4+, prefer:
 * ```ts
 * import { compression } from 'elysia/compression'
 * app.use(compression())
 * ```
 *
 * This function is kept as a documentation/anchor point for the port.
 * The actual compression registration should use the Elysia-native plugin.
 */
export function configureGzip(_config: GzipConfig = DEFAULT_GZIP_CONFIG): void {
  // Elysia v1.4+ provides built-in compression.
  // Register it in the app/route bootstrap instead:
  //
  //   import { compression } from 'elysia/compression'
  //   app.use(compression({
  //     as: 'scoped',         // scope to specific routes/groups
  //     minSize: config.minLength,
  //     compress: {           // zlib options
  //       level: config.level,
  //     },
  //   }))
  //
  // This function exists solely as a documentation anchor.
  console.debug(
    '[gzip] Use Elysia compression plugin in your app bootstrap. See middlewares_gzip.ts for details.',
  )
}
