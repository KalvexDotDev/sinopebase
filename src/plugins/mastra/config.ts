// ---------------------------------------------------------------------------
// Mastra AI — Plugin configuration
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
}

export const DEFAULTS: Required<MastraPluginOptions> = {
  openaiApiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  defaultModel: 'gpt-4o-mini',
  embeddingModel: 'text-embedding-3-small',
  requireAuth: true,
}
