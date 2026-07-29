// ---------------------------------------------------------------------------
// Mastra AI — Plugin for Sinopebase
//
// Provides OpenAI-compatible chat + embeddings API at /api/mastra/*.
// Follows the same plugin pattern as DropFunctions and GhUpdate.
//
// Usage:
//   const plugin = new MastraPlugin({ openaiApiKey: 'sk-...' })
//   await plugin.register(app, betterAuthInstance)
//
// Request-scoped context:
//   - withRequestContext(ctx, fn) — runs fn within an AsyncLocalStorage context
//   - getCurrentRequestContext()  — returns the current request context or null
//   - MCP tools receive the current context via getCurrentRequestContext()
// ---------------------------------------------------------------------------

import { AsyncLocalStorage } from 'node:async_hooks'
import { Elysia } from 'elysia'
import type { IDatabase } from '~/core/db-interface'
import { PostgresDatabase, type PostgresRequestContext } from '~/core/db-postgres'
import { Agent, type Tool } from '~/tools/ai/mastra/agent'
import { createMastraAuth } from '~/tools/ai/mastra/auth-bridge'
import { createMCPTools, type MCPToolOptions } from '~/tools/ai/mastra/mcp-tools'
import { createMockProvider } from '~/tools/ai/mock-provider'
import { OpenAIProvider } from '~/tools/ai/openai'
import type { AIProvider } from '~/tools/ai/provider'
import type { SinopebaseAuth } from '~/tools/auth-better'
import type { IFileStore } from '~/tools/filesystem/store-interface'
import type { MastraPluginOptions } from './config'
import { DEFAULTS } from './config'
import type { AuthContext } from './middleware'
import { validateAIRequest } from './middleware'
import { createChatRoutes } from './routes/chat'
import { createEmbeddingsRoutes } from './routes/embeddings'

// ---------------------------------------------------------------------------
// Request-scoped context — AsyncLocalStorage for per-request propagation
// ---------------------------------------------------------------------------

const requestContextStorage = new AsyncLocalStorage<AuthContext>()

export type { AuthContext }

/**
 * Run a function within a request-scoped auth context.
 * MCP tools and downstream code can retrieve the context via
 * getCurrentRequestContext().
 */
export function withRequestContext<T>(ctx: AuthContext, fn: () => T): T {
  return requestContextStorage.run(ctx, fn)
}

/**
 * Get the current request-scoped auth context, or null if no context
 * has been set (e.g., the call is from an unauthenticated route or
 * outside an HTTP request).
 */
export function getCurrentRequestContext(): AuthContext | null {
  return requestContextStorage.getStore() ?? null
}

/**
 * Create an Elysia-compatible auth middleware that validates Bearer
 * tokens and sets up the request-scoped context for downstream
 * handlers and MCP tools.
 *
 * When `requireAuth` is true, unauthenticated requests are rejected
 * with 401. When false, requests are allowed through but context is
 * still propagated when a valid token is present.
 *
 * Usage:
 * ```ts
 * app.use(createAuthMiddleware(auth))
 * ```
 */
export function createAuthMiddleware(auth: SinopebaseAuth, requireAuth = true) {
  return (app: Elysia) =>
    app.onBeforeHandle(async ({ request, set }) => {
      const ctx = await validateAIRequest(auth, request)
      if (requireAuth && !ctx) {
        set.status = 401
        return { error: 'Invalid or missing Authorization header', status: 401 }
      }
      // Stash on request so onBeforeHandle can pass context downstream
      ;(request as unknown as Record<string, unknown>).__authContext = ctx
    })
}

export class MastraPlugin {
  private options: Required<MastraPluginOptions>
  private provider: AIProvider | null = null
  private agents: Agent[] = []

  constructor(options: MastraPluginOptions = {}) {
    this.options = { ...DEFAULTS, ...options }
  }

  /**
   * Register the plugin with a Sinopebase Elysia app.
   *
   * @param app  The Elysia app instance
   * @param auth Optional better-auth instance for auth-required endpoints
   */
  async register(
    app: Elysia,
    auth?: SinopebaseAuth,
    db?: IDatabase,
    fileStore?: IFileStore,
  ): Promise<Elysia> {
    // Initialise the AI provider
    const apiKey = this.options.openaiApiKey || process.env.OPENAI_API_KEY || ''
    if (apiKey) {
      this.provider = new OpenAIProvider(
        apiKey,
        this.options.baseUrl,
        this.options.defaultModel,
        this.options.embeddingModel,
      )
    } else {
      this.provider = createMockProvider()
    }

    // Create MCP tools from Sinopebase resources
    const mcpOptions: MCPToolOptions = {
      requireAuth: this.options.requireAuth,
    }

    // When using PostgresDatabase, enable request-scoped RLS context so
    // database tools enforce Row-Level Security policies.
    if (db instanceof PostgresDatabase) {
      mcpOptions.resolveRequestContext = () => {
        const ctx = getCurrentRequestContext()
        if (!ctx) return null
        return {
          role: ctx.role as PostgresRequestContext['role'],
          userId: ctx.userId,
        }
      }
    }

    // In production, only expose tools on the privileged allowlist.
    // Sensitive tools like storage_read must be explicitly opted in.
    if (this.options.production) {
      mcpOptions.privilegedTools = this.options.privilegedTools
    }

    const mcpTools: Tool[] = createMCPTools(
      db,
      fileStore,
      () => {
        // Auth context is propagated per-request via AsyncLocalStorage.
        // Tools like auth_user resolve the current user from context.
        return getCurrentRequestContext()
      },
      mcpOptions,
    )

    // Create a default agent
    this.agents = [
      new Agent({
        id: 'default',
        name: 'Sinopebase Assistant',
        instructions:
          'You are a helpful assistant with access to Sinopebase resources. Use tools when appropriate.',
        provider: this.provider,
        tools: mcpTools,
      }),
    ]

    const requireAuth = this.options.requireAuth
    const mastraAuth = auth ? createMastraAuth(auth) : null

    // ---- Agent routes (with request-scoped context) ----
    const agentRoutes = new Elysia({ name: 'sinopebase-mastra-agents' })
      .get('/api/mastra/agents', async ({ request }) => {
        // Propagate context when a valid token is present, even if
        // requireAuth is false
        if (mastraAuth) {
          const user = await mastraAuth.authorize(request)
          if (user) {
            return withRequestContext(user, () => ({
              data: this.agents.map((a) => ({ id: a.id, name: a.name })),
            }))
          }
        }
        return {
          data: this.agents.map((a) => ({ id: a.id, name: a.name })),
        }
      })
      .post('/api/mastra/agents/:id/chat', async ({ params, body, set, request }) => {
        // Auth check + context propagation
        const doHandle = async () => {
          const agent = this.agents.find((a) => a.id === params.id)
          if (!agent) {
            set.status = 404
            return { error: `Agent "${params.id}" not found`, status: 404 }
          }
          const { messages } = body as { messages?: Array<{ role: string; content: string }> }
          if (!messages?.length) {
            set.status = 400
            return { error: 'messages array required', status: 400 }
          }
          try {
            return await agent.generate(messages)
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err)
            set.status = 500
            return { error: msg || 'Agent error', status: 500 }
          }
        }

        if (mastraAuth) {
          const user = await mastraAuth.authorize(request)
          if (requireAuth && !user) {
            set.status = 401
            return { error: 'Unauthorized', status: 401 }
          }
          if (user) return withRequestContext(user, doHandle)
        } else if (requireAuth) {
          set.status = 401
          return { error: 'Auth unavailable', status: 401 }
        }
        return doHandle()
      })
      .post('/api/mastra/agents/:id/stream', async ({ params, body, set, request }) => {
        // Auth check + context propagation
        const doHandle = async () => {
          const agent = this.agents.find((a) => a.id === params.id)
          if (!agent) {
            set.status = 404
            return { error: `Agent "${params.id}" not found`, status: 404 }
          }
          const { messages } = body as { messages?: Array<{ role: string; content: string }> }
          if (!messages?.length) {
            set.status = 400
            return { error: 'messages array required', status: 400 }
          }
          set.headers['Content-Type'] = 'text/event-stream'
          set.headers['Cache-Control'] = 'no-cache'
          const encoder = new TextEncoder()
          const readable = new ReadableStream({
            async start(controller) {
              try {
                for await (const chunk of agent.stream(messages)) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
                }
                controller.enqueue(encoder.encode('data: [DONE]\n\n'))
                controller.close()
              } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err)
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`))
                controller.close()
              }
            },
          })
          return new Response(readable, { headers: { 'Content-Type': 'text/event-stream' } })
        }

        if (mastraAuth) {
          const user = await mastraAuth.authorize(request)
          if (requireAuth && !user) {
            set.status = 401
            return { error: 'Unauthorized', status: 401 }
          }
          if (user) return withRequestContext(user, doHandle)
        } else if (requireAuth) {
          set.status = 401
          return { error: 'Auth unavailable', status: 401 }
        }
        return doHandle()
      })
    app.use(agentRoutes)

    // ---- Backward-compatible chat + embeddings routes ----
    app.use(createChatRoutes(this.provider, requireAuth, auth))
    app.use(createEmbeddingsRoutes(this.provider, requireAuth, auth))

    console.log(
      `Mastra AI: provider "${this.provider.displayName()}", ${this.agents.length} agent(s) ready (auth: ${requireAuth})`,
    )
    return app
  }

  /** Get the AI provider instance. */
  getProvider(): AIProvider | null {
    return this.provider
  }

  /** Get the registered agents. */
  getAgents(): Agent[] {
    return this.agents
  }
}
