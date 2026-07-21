// ---------------------------------------------------------------------------
// AI Provider — Interface (following OAuth2 Provider pattern from src/tools/auth/)
// ---------------------------------------------------------------------------

import type {
  AIMessage,
  ChatOptions,
  ChatResponse,
  ChatChunk,
  EmbeddingOptions,
  EmbeddingResponse,
  AITool,
} from './types'

/**
 * AI Provider interface — mirrors the OAuth2 Provider pattern.
 *
 * Implementations:
 *   - OpenAIProvider    (src/tools/ai/openai.ts)
 *   - AnthropicProvider (future stub)
 *   - GoogleProvider    (future stub)
 */
export interface AIProvider {
  /** Provider display name */
  displayName(): string

  /** Generate a chat completion */
  chat(messages: AIMessage[], options?: ChatOptions): Promise<ChatResponse>

  /** Generate a streaming chat completion */
  chatStream(messages: AIMessage[], options?: ChatOptions): AsyncIterable<ChatChunk>

  /** Generate embeddings for text(s) */
  embeddings(texts: string[], options?: EmbeddingOptions): Promise<EmbeddingResponse>
}

/**
 * Abstract base provider with shared HTTP logic.
 */
export abstract class BaseAIProvider implements AIProvider {
  protected apiKey: string
  protected baseUrl: string
  protected defaultModel: string

  constructor(apiKey: string, baseUrl: string, defaultModel: string) {
    this.apiKey = apiKey
    this.baseUrl = baseUrl
    this.defaultModel = defaultModel
  }

  abstract displayName(): string
  abstract chat(messages: AIMessage[], options?: ChatOptions): Promise<ChatResponse>
  abstract chatStream(messages: AIMessage[], options?: ChatOptions): AsyncIterable<ChatChunk>
  abstract embeddings(texts: string[], options?: EmbeddingOptions): Promise<EmbeddingResponse>

  /** Build standard Authorization header. */
  protected authHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    }
  }

  /** Resolve model name with fallback. */
  protected resolveModel(options?: ChatOptions | EmbeddingOptions): string {
    return options?.model || this.defaultModel
  }
}
