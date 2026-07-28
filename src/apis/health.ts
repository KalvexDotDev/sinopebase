/**
 * Health check API — GET /api/health
 *
 * Port of PocketBase's apis/health.go.
 * Returns 200 OK if the server is healthy, with optional superuser data.
 * Layer 4 — imports from ~/core/*.
 */

import { Elysia } from 'elysia'

export interface HealthCheckData {
  message: string
  code: number
  data: Record<string, unknown>
}

/**
 * Create an Elysia plugin that registers the /api/health endpoint.
 */
export function createHealthPlugin(opts?: { canBackup?: boolean; realIP?: string }) {
  const app = new Elysia({ name: 'sinopebase-health' })

  app.get('/api/health', () => {
    const resp: HealthCheckData = {
      code: 200,
      message: 'API is healthy.',
      data: {},
    }

    // Add extra info if superuser context is available (via query or header)
    // In PocketBase, superuser auth is checked; for simplicity we can
    // accept a query param or just return basic info
    if (opts?.canBackup !== undefined) {
      resp.data = {
        canBackup: opts.canBackup,
        realIP: opts.realIP ?? '127.0.0.1',
        possibleProxyHeader: '',
      }
    }

    return resp
  })

  return app
}

/**
 * Simple health check response (no auth required).
 */
export function healthResponse(): HealthCheckData {
  return {
    code: 200,
    message: 'API is healthy.',
    data: {},
  }
}
