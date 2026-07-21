// ---------------------------------------------------------------------------
// AI Provider — Shared types
// ---------------------------------------------------------------------------

/** A chat message in OpenAI-compatible format. */
export interface AIMessage {
  role: 'system' | 'user' | 'assistant' | 'function'
  content: string
  name?: string
}

/** Options for chat completion requests. */
export interface ChatOptions {
  /** Model name (default: gpt-4o-mini) */
  model?: string
  /** Maximum tokens to generate */
  maxTokens?: number
  /** Sampling temperature (0-2) */
  temperature?: number
  /** Nucleus sampling */
  topP?: number
  /** Stop sequences */
  stop?: string[]
  /** Stream the response */
  stream?: boolean
}

/** A chat completion response. */
export interface ChatResponse {
  id: string
  model: string
  choices: Array<{
    index: number
    message: AIMessage
    finishReason: 'stop' | 'length' | 'content_filter' | 'tool_calls' | null
  }>
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

/** A streaming chat completion chunk. */
export interface ChatChunk {
  id: string
  model: string
  choices: Array<{
    index: number
    delta: { role?: string; content?: string }
    finishReason: string | null
  }>
}

/** Options for embedding generation. */
export interface EmbeddingOptions {
  model?: string
}

/** An embedding vector. */
export interface Embedding {
  index: number
  embedding: number[]
}

/** Embedding generation response. */
export interface EmbeddingResponse {
  model: string
  data: Embedding[]
  usage?: {
    promptTokens: number
    totalTokens: number
  }
}

/** An AI tool definition. */
export interface AITool {
  id: string
  name: string
  description: string
  parameters: Record<string, unknown>
  execute: (input: Record<string, unknown>) => Promise<unknown>
}

/** An AI agent definition. */
export interface AIAgent {
  id: string
  name: string
  instructions: string
  model?: string
  tools?: AITool[]
}
