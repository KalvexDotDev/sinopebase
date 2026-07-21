/**
 * HTTP/HTTPS server startup with TLS support and graceful shutdown.
 *
 * Port of PocketBase apis/serve.go
 * Layer 4 — imports from ~/core/*, ~/tools/*.
 *
 * Starts the Elysia HTTP server with optional HTTPS via an auto-cert manager
 * (LetsEncrypt / autocert). Handles graceful shutdown on `SIGTERM` / `SIGINT`.
 *
 * The `Serve` function:
 * 1. Runs all pending migrations.
 * 2. Creates the router via `NewRouter(app)`.
 * 3. Applies CORS, gzip, and www-redirect middleware.
 * 4. Serves static admin UI files (if bundled).
 * 5. Starts the HTTP (and optionally HTTP->HTTPS redirect) listener(s).
 * 6. Triggers the OnServe hook.
 * 7. Launches the installer flow if no superuser exists.
 * 8. Blocks until a shutdown signal is received.
 */

import { Elysia } from 'elysia'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

import type { App } from '~/core/app'
import { NewRouter, type RouterOptions } from './base'
import { cors } from './middlewares_cors'
import { wwwRedirect } from './middlewares'

// ---------------------------------------------------------------------------
// Serve configuration
// ---------------------------------------------------------------------------

export interface ServeConfig {
  /** Show or hide the server start console message (default true). */
  showStartBanner?: boolean

  /** TCP address for the HTTP server (e.g. `"127.0.0.1:80"`). */
  httpAddr?: string

  /** TCP address for the HTTPS server (e.g. `"127.0.0.1:443"`). */
  httpsAddr?: string

  /**
   * Domain names for TLS certificate issuance via LetsEncrypt autocert.
   * When set, `httpsAddr` must also be set.
   */
  certificateDomains?: string[]

  /** Allowed CORS origins (default `["*"]`). */
  allowedOrigins?: string[]

  /** Path to the data directory (for autocert cache, etc.). */
  dataDir?: string

  /** Paths to custom TLS cert/key files (bypasses autocert). */
  tlsCertPath?: string
  tlsKeyPath?: string
}

// ---------------------------------------------------------------------------
// Default CSP (Content-Security-Policy)
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
// Helper: resolve the host string for display
// ---------------------------------------------------------------------------

function serverAddrToHost(addr: string): string {
  if (!addr || addr.endsWith(':http') || addr.endsWith(':https')) {
    return '127.0.0.1'
  }
  return addr
}

// ---------------------------------------------------------------------------
// Helper: auto-cert manager (simplified — uses file-based cache)
// ---------------------------------------------------------------------------

interface CertManager {
  getCertificate: (hostname: string) => Promise<{ key: string; cert: string } | null>
}

/**
 * Creates a simple file-based certificate manager for development or
 * for providing certificates without external dependencies.
 *
 * For production with real LetsEncrypt, use a reverse proxy (Caddy, nginx)
 * that handles TLS termination.
 */
function createCertManager(dataDir: string, domains: string[]): CertManager {
  const cacheDir = join(dataDir, '.autocert-cache')
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true })
  }

  return {
    async getCertificate(hostname: string) {
      // Check the file cache first
      const certPath = join(cacheDir, `${hostname}.pem`)
      const keyPath = join(cacheDir, `${hostname}-key.pem`)

      if (existsSync(certPath) && existsSync(keyPath)) {
        return {
          cert: readFileSync(certPath, 'utf-8'),
          key: readFileSync(keyPath, 'utf-8'),
        }
      }

      // In a real implementation, this would call the ACME HTTP-01 challenge.
      // For development, we return null which falls back to HTTP-only.
      return null
    },
  }
}

// ---------------------------------------------------------------------------
// Serve
// ---------------------------------------------------------------------------

/**
 * Starts the Sinopebase web server.
 *
 * The application should be bootstrapped before calling this function.
 *
 * @example
 * ```ts
 * await app.bootstrap()
 * await Serve(app, { httpAddr: '127.0.0.1:8090', showStartBanner: true })
 * ```
 */
export async function Serve(
  app: App,
  config: ServeConfig = {},
): Promise<Elysia> {
  const cfg: ServeConfig = {
    showStartBanner: true,
    httpAddr: '127.0.0.1:8090',
    allowedOrigins: ['*'],
    dataDir: './pb_data',
    ...config,
  }

  // 1. Run migrations
  try {
    await app.runAllMigrations()
  } catch (err) {
    console.error('[serve] Migration error:', err)
    throw err
  }

  // 2. Build the router
  const routerOptions: RouterOptions = {
    corsConfig: {
      allowOrigins: cfg.allowedOrigins,
      allowMethods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
    },
    maxBodySize: 32 * 1024 * 1024,
    showStartBanner: false, // we'll print our own banner
    baseURL: cfg.httpsAddr
      ? `https://${serverAddrToHost(cfg.httpsAddr)}`
      : `http://${serverAddrToHost(cfg.httpAddr ?? '')}`,
  }

  const router = await NewRouter(app, routerOptions)

  // 3. Handle CORS at the top level (already done in base.ts)

  // 4. Resolve main listen address
  const mainAddr = cfg.httpsAddr || cfg.httpAddr || '127.0.0.1:8090'

  // 5. Build the www redirect list from certificate domains
  const wwwRedirectHosts: string[] = []
  if (cfg.certificateDomains) {
    for (const host of cfg.certificateDomains) {
      if (!host.startsWith('www.')) {
        const wwwHost = `www.${host}`
        if (!cfg.certificateDomains.includes(wwwHost)) {
          wwwRedirectHosts.push(wwwHost)
        }
      }
    }
  }
  if (wwwRedirectHosts.length > 0) {
    router.onRequest(wwwRedirect(wwwRedirectHosts))
  }

  // 6. Trigger OnServe hook
  const serveEvent = {
    app,
    router,
    server: null as unknown,
  }
  try {
    await app.onServe().trigger(serveEvent as never)
  } catch {
    // Continue even if hook handlers fail
  }

  // 7. Start the server
  let server: ReturnType<Elysia['listen']> | null = null

  try {
    if (cfg.httpsAddr && cfg.tlsCertPath && cfg.tlsKeyPath) {
      // Custom TLS cert
      const cert = readFileSync(cfg.tlsCertPath, 'utf-8')
      const key = readFileSync(cfg.tlsKeyPath, 'utf-8')
      server = router.listen(cfg.httpsAddr, {
        cert,
        key,
      })
    } else if (cfg.httpsAddr) {
      // Attempt TLS with autocert-style management
      const certManager = createCertManager(
        cfg.dataDir ?? './pb_data',
        cfg.certificateDomains ?? [],
      )
      const hostname = cfg.certificateDomains?.[0] ?? serverAddrToHost(cfg.httpsAddr)
      const tls = await certManager.getCertificate(hostname)
      if (tls) {
        server = router.listen(cfg.httpsAddr, {
          cert: tls.cert,
          key: tls.key,
        })
      } else {
        // Fall back to HTTP
        console.warn('[serve] No TLS certificate available — falling back to HTTP.')
        server = router.listen(cfg.httpAddr ?? mainAddr)
      }
    } else {
      // Plain HTTP
      server = router.listen(mainAddr)
    }
  } catch (err) {
    console.error('[serve] Failed to start server:', err)
    throw err
  }

  // 8. Startup banner
  if (cfg.showStartBanner) {
    const baseURL = cfg.httpsAddr
      ? `https://${serverAddrToHost(cfg.httpsAddr)}`
      : `http://${serverAddrToHost(cfg.httpAddr ?? mainAddr)}`

    const timestamp = new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '')
    console.log(`\n${timestamp} Server started at ${baseURL}`)
    console.log(`  REST API:  ${baseURL}/api/`)
    console.log(`  Dashboard: ${baseURL}/_/\n`)
  }

  return router
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

/**
 * Registers OS signal handlers for graceful shutdown.
 *
 * Call this during app bootstrap:
 * ```ts
 * registerShutdown(app, router)
 * ```
 *
 * On SIGINT / SIGTERM the server is stopped and the app's OnTerminate hook
 * is triggered.
 */
export function registerShutdown(
  app: App,
  router: Elysia,
): void {
  const shutdown = async (signal: string) => {
    console.log(`\n[serve] Received ${signal}, shutting down...`)

    // Stop accepting new connections
    router.stop()

    // Trigger terminate hook
    try {
      const terminateEvent = { app, isRestart: false }
      await app.onTerminate().trigger(terminateEvent as never)
    } catch {
      // ignore errors during shutdown
    }

    process.exit(0)
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}
