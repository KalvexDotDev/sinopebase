// ---------------------------------------------------------------------------
// Mastra AI — Embeddings route
// POST /api/mastra/embeddings
// ---------------------------------------------------------------------------

import { Elysia } from 'elysia'
import type { AIProvider } from '~/tools/ai/provider'
import { validateAIRequest } from '../middleware'
import { withRequestContext } from '../plugin'

export function createEmbeddingsRoutes(provider: AIProvider, requireAuth: boolean, auth: unknown) {
  return new Elysia().post('/api/mastra/embeddings', async ({ request, body, set }) => {
    // Resolve auth context (rejects if requireAuth and no valid token)
    const authCtx = await validateAIRequest(auth, request)
    if (requireAuth && !authCtx) {
      set.status = 401
      return { error: 'Invalid or missing Authorization header', status: 401 }
    }

    const doHandle = async () => {
      const { input, model } = body as {
        input?: string | string[]
        model?: string
      }

      if (!input) {
        set.status = 400
        return { error: 'input is required', status: 400 }
      }

      const texts = Array.isArray(input) ? input : [input]
      if (texts.length === 0) {
        set.status = 400
        return { error: 'input array is empty', status: 400 }
      }

      try {
        const response = await provider.embeddings(texts, { model })
        return response
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        set.status = 500
        return { error: message, status: 500 }
      }
    }

    // Run handler within request context when authenticated
    if (authCtx) return withRequestContext(authCtx, doHandle)
    return doHandle()
  })
}
