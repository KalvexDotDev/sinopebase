// ---------------------------------------------------------------------------
// Mastra AI — Auth middleware
// ---------------------------------------------------------------------------

/**
 * Validate a Bearer token via direct DB session lookup.
 * Same pattern as DropFunctions middleware and createAuthPlugin.
 */
export async function validateAIRequest(
  auth: any,
  request: Request,
): Promise<boolean> {
  // If no auth instance, skip validation (in-memory mode)
  if (!auth) return true

  const authHeader = request.headers.get('authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return false

  const token = authHeader.slice(7)
  if (!token) return false

  try {
    const db = (auth as any).__db
    if (!db) return false

    const sessions = await db
      .selectFrom('session')
      .where('session.token', '=', token)
      .where('session.expiresAt', '>', new Date())
      .execute()

    return sessions.length > 0
  } catch {
    return false
  }
}
