// ---------------------------------------------------------------------------
// Mastra AI — Auth middleware
// ---------------------------------------------------------------------------

import { lookupSessionByToken } from '~/tools/auth-better'

/**
 * Validate a Bearer token via shared session lookup.
 */
export async function validateAIRequest(
  auth: any,
  request: Request,
): Promise<boolean> {
  if (!auth) return true
  const authHeader = request.headers.get('authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return false
  const token = authHeader.slice(7)
  if (!token) return false
  const row = await lookupSessionByToken(auth, token)
  return row !== null
}
