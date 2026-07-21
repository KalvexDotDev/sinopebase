// ---------------------------------------------------------------------------
// Mastra AI — Plugin for Sinopebase
//
// Provides OpenAI-compatible chat + embeddings API at /api/mastra/*.
// Follows the same plugin pattern as DropFunctions and GhUpdate.
//
// Usage:
//   const plugin = new MastraPlugin({ openaiApiKey: 'sk-...' })
//   await plugin.register(app, betterAuthInstance)
// ---------------------------------------------------------------------------

import { Elysia } from 'elysia'
import type { MastraPluginOptions } from './config'
import { DEFAULTS } from './config'
import { OpenAIProvider } from '~/tools/ai/openai'
import type { AIProvider } from '~/tools/ai/provider'
import { createMockProvider } from '~/tools/ai/mock-provider'
import { createChatRoutes } from './routes/chat'
import { createEmbeddingsRoutes } from './routes/embeddings'
import { Agent, type Tool } from '~/tools/ai/mastra/agent'
import { createMCPTools } from '~/tools/ai/mastra/mcp-tools'
import { createMastraAuth } from '~/tools/ai/mastra/auth-bridge'

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
  async register(app: Elysia, auth?: any, db?: any, fileStore?: any): Promise<void> {
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
    const mcpTools: Tool[] = createMCPTools(db, fileStore, () => {
      // Auth context is per-request; tools get it lazily
      return null // tools like auth_user resolve this at call time
    })

    // Create a default agent
    this.agents = [
      new Agent({
        id: 'default',
        name: 'Sinopebase Assistant',
        instructions: 'You are a helpful assistant with access to Sinopebase resources. Use tools when appropriate.',
        provider: this.provider,
        tools: mcpTools,
      }),
    ]

    const requireAuth = this.options.requireAuth
    const mastraAuth = auth ? createMastraAuth(auth) : null

    // ---- Agent routes ----
    const agentRoutes = new Elysia()
      .get('/api/mastra/agents', () => ({
        data: this.agents.map((a) => ({ id: a.id, name: a.name })),
      }))
      .post('/api/mastra/agents/:id/chat', async ({ params, body, set, request }) => {
        if (requireAuth && mastraAuth) {
          const user = await mastraAuth.authorize(request)
          if (!user) { set.status = 401; return { error: 'Unauthorized', status: 401 } }
        }
        const agent = this.agents.find((a) => a.id === params.id)
        if (!agent) { set.status = 404; return { error: `Agent "${params.id}" not found`, status: 404 } }
        const { messages } = body as { messages?: Array<{ role: string; content: string }> }
        if (!messages?.length) { set.status = 400; return { error: 'messages array required', status: 400 } }
        try {
          return await agent.generate(messages)
        } catch (err: any) { set.status = 500; return { error: err?.message || 'Agent error', status: 500 } }
      })
      .post('/api/mastra/agents/:id/stream', async ({ params, body, set, request }) => {
        if (requireAuth && mastraAuth) {
          const user = await mastraAuth.authorize(request)
          if (!user) { set.status = 401; return { error: 'Unauthorized', status: 401 } }
        }
        const agent = this.agents.find((a) => a.id === params.id)
        if (!agent) { set.status = 404; return { error: `Agent "${params.id}" not found`, status: 404 } }
        const { messages } = body as { messages?: Array<{ role: string; content: string }> }
        if (!messages?.length) { set.status = 400; return { error: 'messages array required', status: 400 } }
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
            } catch (err: any) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: err?.message })}\n\n`))
              controller.close()
            }
          },
        })
        return new Response(readable, { headers: { 'Content-Type': 'text/event-stream' } })
      })
    app.use(agentRoutes)

    // ---- Backward-compatible chat + embeddings routes ----
    app.use(createChatRoutes(this.provider, requireAuth, auth))
    app.use(createEmbeddingsRoutes(this.provider, requireAuth, auth))

    console.log(
      `Mastra AI: provider "${this.provider.displayName()}", ${this.agents.length} agent(s) ready (auth: ${requireAuth})`,
    )
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

