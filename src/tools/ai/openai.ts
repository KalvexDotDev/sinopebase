// ---------------------------------------------------------------------------
// AI Provider — OpenAI implementation
// ---------------------------------------------------------------------------

import { BaseAIProvider } from './provider'
import type {
  AIMessage,
  ChatChunk,
  ChatOptions,
  ChatResponse,
  EmbeddingOptions,
  EmbeddingResponse,
} from './types'

// ---------------------------------------------------------------------------
// Raw OpenAI API response interfaces (snake_case from wire format)
// ---------------------------------------------------------------------------

interface RawOpenAIChoice {
  index: number
  message: { role: string; content: string }
  finish_reason: string | null
}

interface RawOpenAIResponse {
  id: string
  model: string
  choices: RawOpenAIChoice[]
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

interface RawOpenAIStreamChoice {
  index: number
  delta: { role?: string; content?: string }
  finish_reason: string | null
}

interface RawOpenAIStreamChunk {
  id: string
  model: string
  choices: RawOpenAIStreamChoice[]
}

interface RawOpenAIEmbeddingItem {
  index: number
  embedding: number[]
}

interface RawOpenAIEmbeddingResponse {
  model: string
  data: RawOpenAIEmbeddingItem[]
  usage?: {
    prompt_tokens: number
    total_tokens: number
  }
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_MODEL = 'gpt-4o-mini'
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small'

export class OpenAIProvider extends BaseAIProvider {
  private embeddingModel: string

  constructor(apiKey: string, baseUrl?: string, defaultModel?: string, embeddingModel?: string) {
    super(
      apiKey || process.env.OPENAI_API_KEY || '',
      baseUrl || process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL,
      defaultModel || DEFAULT_MODEL,
    )
    this.embeddingModel = embeddingModel || DEFAULT_EMBEDDING_MODEL
  }

  displayName(): string {
    return 'openai'
  }

  async chat(messages: AIMessage[], options?: ChatOptions): Promise<ChatResponse> {
    const model = this.resolveModel(options)
    const body: Record<string, unknown> = {
      model,
      messages,
      stream: false,
    }
    if (options?.maxTokens) body.max_tokens = options.maxTokens
    if (options?.temperature !== undefined) body.temperature = options.temperature
    if (options?.topP !== undefined) body.top_p = options.topP
    if (options?.stop) body.stop = options.stop

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errorBody = await res.text()
      throw new Error(`OpenAI chat error (${res.status}): ${errorBody}`)
    }

    const data = (await res.json()) as RawOpenAIResponse
    return {
      id: data.id || crypto.randomUUID(),
      model: data.model || model,
      choices: (data.choices || []).map((c: RawOpenAIChoice) => ({
        index: c.index || 0,
        message: c.message || { role: 'assistant', content: '' },
        finishReason: c.finish_reason || null,
      })),
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens || 0,
            completionTokens: data.usage.completion_tokens || 0,
            totalTokens: data.usage.total_tokens || 0,
          }
        : undefined,
    }
  }

  async *chatStream(messages: AIMessage[], options?: ChatOptions): AsyncIterable<ChatChunk> {
    const model = this.resolveModel(options)
    const body: Record<string, unknown> = {
      model,
      messages,
      stream: true,
    }
    if (options?.maxTokens) body.max_tokens = options.maxTokens
    if (options?.temperature !== undefined) body.temperature = options.temperature

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errorBody = await res.text()
      throw new Error(`OpenAI stream error (${res.status}): ${errorBody}`)
    }

    if (!res.body) {
      throw new Error('No response body for stream')
    }

    // Parse SSE stream
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed?.startsWith('data: ')) continue
          const data = trimmed.slice(6)
          if (data === '[DONE]') return

          try {
            const parsed = JSON.parse(data) as RawOpenAIStreamChunk
            yield {
              id: parsed.id || crypto.randomUUID(),
              model: parsed.model || model,
              choices: (parsed.choices || []).map((c: RawOpenAIStreamChoice) => ({
                index: c.index || 0,
                delta: c.delta || {},
                finishReason: c.finish_reason || null,
              })),
            }
          } catch {
            // Skip malformed chunks
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  async embeddings(texts: string[], options?: EmbeddingOptions): Promise<EmbeddingResponse> {
    const model = options?.model || this.embeddingModel
    const input = texts.length === 1 ? texts[0] : texts

    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ model, input }),
    })

    if (!res.ok) {
      const errorBody = await res.text()
      throw new Error(`OpenAI embeddings error (${res.status}): ${errorBody}`)
    }

    const data = (await res.json()) as RawOpenAIEmbeddingResponse
    return {
      model: data.model || model,
      data: (data.data || []).map((d: RawOpenAIEmbeddingItem) => ({
        index: d.index || 0,
        embedding: d.embedding || [],
      })),
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens || 0,
            totalTokens: data.usage.total_tokens || 0,
          }
        : undefined,
    }
  }
}
