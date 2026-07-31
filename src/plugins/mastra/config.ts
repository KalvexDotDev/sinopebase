// ---------------------------------------------------------------------------
// Mastra AI — Plugin configuration
// ---------------------------------------------------------------------------
//
// Route audit table — all 6 Mastra API routes and their auth requirements:
//
//   Method  Path                          Auth  Handler scope
//   ------  ----                          ----  -------------
//   GET     /api/mastra/agents            Y     plugin.ts (agentRoutes)
//   POST    /api/mastra/agents/:id/chat   Y     plugin.ts (agentRoutes)
//   POST    /api/mastra/agents/:id/stream Y     plugin.ts (agentRoutes)
//   POST    /api/mastra/chat              Y     routes/chat.ts
//   POST    /api/mastra/chat/stream       Y     routes/chat.ts
//   POST    /api/mastra/embeddings        Y     routes/embeddings.ts
//
// All routes require auth when `requireAuth: true` (default).
// When `requireAuth: false`, routes are open but still propagate
// authenticated context via AsyncLocalStorage when a valid Bearer
// token is present.
// ---------------------------------------------------------------------------

export interface MastraPluginOptions {
  /** OpenAI API key (default: OPENAI_API_KEY env var) */
  openaiApiKey?: string
  /** OpenAI-compatible base URL (default: https://api.openai.com/v1) */
  baseUrl?: string
  /** Default chat model (default: gpt-4o-mini) */
  defaultModel?: string
  /** Default embeddings model (default: text-embedding-3-small) */
  embeddingModel?: string
  /** Require auth for all AI endpoints (default: true) */
  requireAuth?: boolean
  /**
   * Enable production mode — only tools in `privilegedTools` are exposed
   * to AI agents. Tools like `storage_read` must be explicitly opted in.
   * (default: false)
   */
  production?: boolean
  /**
   * Allowlist of MCP tool IDs exposed in production mode.
   * Only tools in this list are registered when `production: true`.
   * Default: ['db_query', 'db_schema', 'storage_list', 'auth_user']
   */
  privilegedTools?: string[]
}

export const DEFAULTS: Required<MastraPluginOptions> = {
  openaiApiKey: '',
  baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  defaultModel: 'gpt-4o-mini',
  embeddingModel: 'text-embedding-3-small',
  requireAuth: true,
  production: false,
  privilegedTools: ['db_query', 'db_schema', 'storage_list', 'auth_user'],
}
