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

    // Load agents from DB if available, otherwise create defaults in memory
    if (db instanceof PostgresDatabase) {
      try {
        const { ensureMastraTables, loadAgents } = await import('./agent-store')
        const pool = db.getPool()
        await ensureMastraTables(pool)
        const saved = await loadAgents(pool)
        if (saved.length > 0) {
          this.agents = saved.map(
            (a) =>
              new Agent({
                id: a.id,
                name: a.name,
                description: a.description,
                instructions: a.instructions,
                provider: this.provider!,
                model: a.model,
                tools: mcpTools,
              }),
          )
        } else {
          // First run — create default agent and persist
          this.agents = [
            new Agent({
              id: 'default',
              name: 'Sinopebase Assistant',
              instructions:
                'You are a helpful assistant with access to Sinopebase resources. Use tools when appropriate.',
              provider: this.provider!,
              tools: mcpTools,
            }),
          ]
          const { createAgent } = await import('./agent-store')
          for (const a of this.agents) {
            await createAgent(pool, {
              id: a.id,
              name: a.name,
              description: a.description,
              instructions: a.instructions,
              model: 'deepseek-chat',
            }).catch(() => {})
          }
        }
      } catch {
        /* fall through to in-memory */
      }
    }
    if (this.agents.length === 0) {
      this.agents = [
        new Agent({
          id: 'default',
          name: 'Sinopebase Assistant',
          instructions: 'You are a helpful assistant.',
          provider: this.provider!,
          tools: mcpTools,
        }),
      ]
    }

    const requireAuth = this.options.requireAuth
    const mastraAuth = auth ? createMastraAuth(auth) : null
    const serviceKey = process.env.SINOPEBASE_SERVICE_ROLE_KEY || ''

    // Helper: check if request is authorized (service_role key or valid user token)
    async function checkAuth(request: Request): Promise<boolean> {
      if (!requireAuth) return true
      const h = request.headers.get('authorization') ?? ''
      const token = h.startsWith('Bearer ') ? h.slice(7) : h
      if (serviceKey && token === serviceKey) return true
      if (mastraAuth) {
        const user = await mastraAuth.authorize(request)
        return !!user
      }
      return false
    }

    // ---- Agent CRUD + chat routes (with request-scoped context) ----
    const agentRoutes = new Elysia({ name: 'sinopebase-mastra-agents' })
      // List agents
      .get('/api/mastra/agents', async ({ request }) => {
        if (mastraAuth) {
          const user = await mastraAuth.authorize(request)
          if (user) {
            return withRequestContext(user, () => ({
              data: this.agents.map((a) => ({
                id: a.id,
                name: a.name,
                description: a.description,
                instructions: a.instructions,
                model: this.provider?.displayName?.() ?? 'deepseek-chat',
              })),
            }))
          }
        }
        return {
          data: this.agents.map((a) => ({
            id: a.id,
            name: a.name,
            description: a.description,
            instructions: a.instructions,
            model: this.provider?.displayName?.() ?? 'deepseek-chat',
          })),
        }
      })
      // Create agent
      .post('/api/mastra/agents', async ({ request, body, set }) => {
        if (!(await checkAuth(request))) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const { id, name, description, instructions, model } = body as any
        if (!name) {
          set.status = 400
          return { error: 'name is required' }
        }
        const agent = new Agent({
          id: id || crypto.randomUUID(),
          name,
          description: description || '',
          instructions: instructions || 'You are a helpful assistant.',
          provider: this.provider!,
          tools: [],
        })
        this.agents.push(agent)
        // Persist to DB
        if (db instanceof PostgresDatabase) {
          const { createAgent } = await import('./agent-store')
          await createAgent(db.getPool(), {
            id: agent.id,
            name: agent.name,
            description: agent.description,
            instructions: agent.instructions,
            model: model || 'deepseek-chat',
          }).catch(() => {})
        }
        return { data: { id: agent.id, name: agent.name } }
      })
      // Update agent
      .patch('/api/mastra/agents/:id', async ({ request, params, body, set }) => {
        if (!(await checkAuth(request))) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const idx = this.agents.findIndex((a) => a.id === params.id)
        if (idx === -1) {
          set.status = 404
          return { error: 'Agent not found' }
        }
        const { name, description, instructions, model } = body as any
        const existing = this.agents[idx]!
        if (name) existing.name = name
        if (description !== undefined) existing.description = description
        if (instructions !== undefined) existing.instructions = instructions
        // Persist to DB
        if (db instanceof PostgresDatabase) {
          const { updateAgent } = await import('./agent-store')
          await updateAgent(db.getPool(), params.id, {
            name,
            description,
            instructions,
            model,
          }).catch(() => {})
        }
        return { data: { id: existing.id, name: existing.name } }
      })
      // Delete agent
      .delete('/api/mastra/agents/:id', async ({ request, params, set }) => {
        if (!(await checkAuth(request))) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const idx = this.agents.findIndex((a) => a.id === params.id)
        if (idx === -1) {
          set.status = 404
          return { error: 'Agent not found' }
        }
        this.agents.splice(idx, 1)
        // Persist to DB
        if (db instanceof PostgresDatabase) {
          const { deleteAgent } = await import('./agent-store')
          await deleteAgent(db.getPool(), params.id).catch(() => {})
        }
        return { message: 'Agent deleted' }
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
            const result = await agent.generate(messages)
            return {
              message: { content: result.text },
              usage: result.usage,
              toolCalls: result.toolCalls,
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err)
            set.status = 500
            return { error: msg || 'Agent error', status: 500 }
          }
        }

        if (!(await checkAuth(request))) {
          set.status = 401
          return { error: 'Unauthorized', status: 401 }
        }
        if (mastraAuth) {
          const user = await mastraAuth.authorize(request)
          if (user) return withRequestContext(user, doHandle)
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

        if (!(await checkAuth(request))) {
          set.status = 401
          return { error: 'Unauthorized', status: 401 }
        }
        if (mastraAuth) {
          const user = await mastraAuth.authorize(request)
          if (user) return withRequestContext(user, doHandle)
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
