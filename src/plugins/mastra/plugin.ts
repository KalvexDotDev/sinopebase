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

export class MastraPlugin {
  private options: Required<MastraPluginOptions>
  private provider: AIProvider | null = null

  constructor(options: MastraPluginOptions = {}) {
    this.options = { ...DEFAULTS, ...options }
  }

  /**
   * Register the plugin with a Sinopebase Elysia app.
   *
   * @param app  The Elysia app instance
   * @param auth Optional better-auth instance for auth-required endpoints
   */
  async register(app: Elysia, auth?: any): Promise<void> {
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
      // Create a mock provider for testing/development (returns echo responses)
      this.provider = createMockProvider()
    }

    const requireAuth = this.options.requireAuth

    // Mount chat routes
    app.use(createChatRoutes(this.provider, requireAuth, auth))

    // Mount embeddings routes
    app.use(createEmbeddingsRoutes(this.provider, requireAuth, auth))

    console.log(
      `Mastra AI: provider "${this.provider.displayName()}" ready (auth: ${requireAuth})`,
    )
  }

  /** Get the AI provider instance. */
  getProvider(): AIProvider | null {
    return this.provider
  }
}

