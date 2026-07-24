// ---------------------------------------------------------------------------
// Mastra AI — Auth middleware
//
// Provides bearer-token validation and Elysia-compatible auth middleware
// for all 6 Mastra API routes.
// ---------------------------------------------------------------------------

import { lookupSessionByToken } from '~/tools/auth-better'
import type { Elysia } from 'elysia'

/** Authenticated user context extracted from a valid Bearer token. */
export interface AuthContext {
  userId: string
  email: string
  role: string
}

/**
 * Validate a Bearer token via shared session lookup.
 *
 * Returns the authenticated user context, or null if the token is
 * missing, invalid, or expired.
 */
export async function validateAIRequest(
  auth: any,
  request: Request,
): Promise<AuthContext | null> {
  if (!auth) return null
  const authHeader = request.headers.get('authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  if (!token) return null
  const row = await lookupSessionByToken(auth, token)
  if (!row) return null
  return {
    userId: row.id,
    email: row.email,
    role: row.role || 'authenticated',
  }
}

/**
 * Create an Elysia-compatible auth middleware.
 *
 * Validates the Bearer token on every incoming request and rejects
 * unauthenticated requests with 401. The auth context is stored on
 * the request object at `__authContext` for downstream handlers to
 * propagate via `withRequestContext`.
 *
 * Usage:
 * ```ts
 * app.use(createAuthMiddleware(auth))
 * ```
 */
export function createAuthMiddleware(auth: any): (app: Elysia) => Elysia {
  return (app: Elysia): Elysia => {
    app.onBeforeHandle(async ({ request, set }: any) => {
      const ctx = await validateAIRequest(auth, request)
      if (!ctx) {
        set.status = 401
        return { error: 'Invalid or missing Authorization header', status: 401 }
      }
      // Attach to request so route handlers can pick it up
      ;(request as unknown as Record<string, unknown>)['__authContext'] = ctx
    })
    return app as unknown as Elysia
  }
}
