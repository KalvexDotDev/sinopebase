// ---------------------------------------------------------------------------
// Mastra AI — Auth bridge: better-auth → Mastra API authentication
//
// Equivalent to @mastra/auth-supabase but for better-auth.
// Validates Bearer tokens on Mastra API calls using the same session lookup
// used by the REST API, DropFunctions, and Admin UI.
// ---------------------------------------------------------------------------

import { lookupSessionByToken, type SinopebaseAuth } from '~/tools/auth-better'

export interface MastraAuthUser {
  userId: string
  email: string
  role: string
}

export interface MastraAuth {
  /** Validate a request and return the authenticated user, or null. */
  authorize(request: Request): Promise<MastraAuthUser | null>
}

/**
 * Create a Mastra-compatible auth provider backed by better-auth.
 *
 * Usage in MastraPlugin:
 * ```ts
 * const mastraAuth = createMastraAuth(auth)
 * const user = await mastraAuth.authorize(request)
 * ```
 */
export function createMastraAuth(auth: SinopebaseAuth): MastraAuth {
  return {
    async authorize(request: Request): Promise<MastraAuthUser | null> {
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
    },
  }
}
