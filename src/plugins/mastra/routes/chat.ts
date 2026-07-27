// ---------------------------------------------------------------------------
// Mastra AI — Chat completion route
// POST /api/mastra/chat
// ---------------------------------------------------------------------------

import { Elysia } from 'elysia'
import type { AIProvider } from '~/tools/ai/provider'
import type { AIMessage } from '~/tools/ai/types'
import { validateAIRequest } from '../middleware'
import { withRequestContext } from '../plugin'

export function createChatRoutes(provider: AIProvider, requireAuth: boolean, auth: unknown) {
  return (
    new Elysia()
      // Chat completion — returns full response
      .post('/api/mastra/chat', async ({ request, body, set }) => {
        // Resolve auth context (rejects if requireAuth and no valid token)
        const authCtx = await validateAIRequest(auth, request)
        if (requireAuth && !authCtx) {
          set.status = 401
          return { error: 'Invalid or missing Authorization header', status: 401 }
        }

        const doHandle = async () => {
          const { messages, model, max_tokens, temperature, top_p, stop } = body as {
            messages?: AIMessage[]
            model?: string
            max_tokens?: number
            temperature?: number
            top_p?: number
            stop?: string[]
          }

          if (!messages || !Array.isArray(messages) || messages.length === 0) {
            set.status = 400
            return { error: 'messages array is required', status: 400 }
          }

          try {
            const response = await provider.chat(messages, {
              model,
              maxTokens: max_tokens,
              temperature,
              topP: top_p,
              stop,
            })
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

      // Streaming chat completion — SSE response
      .post('/api/mastra/chat/stream', async ({ request, body, set }) => {
        // Resolve auth context (rejects if requireAuth and no valid token)
        const authCtx = await validateAIRequest(auth, request)
        if (requireAuth && !authCtx) {
          set.status = 401
          return { error: 'Invalid or missing Authorization header', status: 401 }
        }

        const doHandle = async () => {
          const { messages, model, max_tokens, temperature } = body as {
            messages?: AIMessage[]
            model?: string
            max_tokens?: number
            temperature?: number
          }

          if (!messages || !Array.isArray(messages) || messages.length === 0) {
            set.status = 400
            return { error: 'messages array is required', status: 400 }
          }

          // Set up SSE headers
          set.headers['Content-Type'] = 'text/event-stream'
          set.headers['Cache-Control'] = 'no-cache'
          set.headers.Connection = 'keep-alive'

          try {
            const stream = provider.chatStream(messages, {
              model,
              maxTokens: max_tokens,
              temperature,
            })

            // Pipe the stream as SSE
            const encoder = new TextEncoder()
            const readable = new ReadableStream({
              async start(controller) {
                try {
                  for await (const chunk of stream) {
                    const data = `data: ${JSON.stringify(chunk)}\n\n`
                    controller.enqueue(encoder.encode(data))
                  }
                  controller.enqueue(encoder.encode('data: [DONE]\n\n'))
                  controller.close()
                } catch (err) {
                  const message = err instanceof Error ? err.message : String(err)
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`),
                  )
                  controller.close()
                }
              },
            })

            return new Response(readable, {
              headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
              },
            })
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
  )
}
