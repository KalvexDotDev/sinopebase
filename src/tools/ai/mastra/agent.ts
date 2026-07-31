// ---------------------------------------------------------------------------
// Mastra AI — Agent system (Mastra-compatible API surface)
//
// Implements Mastra's Agent API without requiring @mastra/core.
// When @mastra/core becomes Bun-compatible, swap the backend transparently.
// ---------------------------------------------------------------------------

import { OpenAIProvider } from '~/tools/ai/openai'
import type { AIProvider } from '~/tools/ai/provider'
import type { AIMessage, ChatChunk } from '~/tools/ai/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Tool {
  id: string
  name: string
  description: string
  parameters: Record<string, unknown>
  execute: (input: Record<string, unknown>) => Promise<unknown>
}

export interface AgentConfig {
  id: string
  name: string
  instructions: string
  model?: string
  tools?: Tool[]
  provider?: AIProvider
}

export interface AgentResult {
  text: string
  toolCalls?: Array<{ name: string; args: Record<string, unknown>; result: unknown }>
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

let defaultProvider: AIProvider | null = null

function getDefaultProvider(): AIProvider {
  if (!defaultProvider) {
    const apiKey = process.env.OPENAI_API_KEY || ''
    if (apiKey) {
      defaultProvider = new OpenAIProvider(apiKey)
    } else {
      // Lazy import to avoid circular deps
      const { createMockProvider } = require('~/tools/ai/mock-provider') as {
        createMockProvider: () => AIProvider
      }
      defaultProvider = createMockProvider()
    }
  }
  return defaultProvider
}

export class Agent {
  public readonly id: string
  public name: string
  public instructions: string
  public description: string = ''
  private model: string
  private tools: Tool[]
  private provider: AIProvider

  constructor(config: AgentConfig) {
    this.id = config.id
    this.name = config.name
    this.instructions = config.instructions
    this.model = config.model || 'deepseek-chat'
    this.tools = config.tools || []
    this.provider = config.provider || getDefaultProvider()
  }

  /**
   * Generate a response. If tools are configured, supports multi-step
   * tool calling up to maxSteps (default 5).
   */
  async generate(
    messages: Array<{ role: string; content: string }>,
    options?: { maxSteps?: number },
  ): Promise<AgentResult> {
    const maxSteps = options?.maxSteps ?? 5
    const systemMsg: AIMessage = { role: 'system', content: this.instructions }
    const chatMessages: AIMessage[] = [
      systemMsg,
      ...messages.map((m) => ({ role: m.role as AIMessage['role'], content: m.content })),
    ]
    const toolCalls: AgentResult['toolCalls'] = []

    // Rebuild messages array to include system prompt for each step
    const currentMessages = [...chatMessages]

    for (let step = 0; step < maxSteps; step++) {
      const response = await this.provider.chat(currentMessages, {
        model: this.model,
        temperature: 0.7,
      })

      const choice = response.choices[0]
      if (!choice) break

      const content = choice.message.content

      // Check for tool calls in the response (OpenAI function calling format)
      if (this.tools.length > 0 && content) {
        const toolCall = this.parseToolCall(content)
        if (toolCall) {
          const tool = this.tools.find((t) => t.name === toolCall.name)
          if (tool) {
            try {
              const result = await tool.execute(toolCall.args)
              toolCalls.push({ name: toolCall.name, args: toolCall.args, result })
              // Append the tool result so the agent can continue
              currentMessages.push({
                role: 'function',
                name: toolCall.name,
                content: JSON.stringify(result),
              })
              continue // next step
            } catch {
              // Tool failed, return what we have
              break
            }
          }
        }
      }

      // No more tool calls — return final text
      return {
        text: content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: response.usage,
      }
    }

    // Max steps reached — return last response
    const lastMsg = currentMessages[currentMessages.length - 1]
    return {
      text: lastMsg?.content || '',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    }
  }

  /** Streaming generation (delegates to provider.chatStream). */
  async *stream(messages: Array<{ role: string; content: string }>): AsyncIterable<ChatChunk> {
    const systemMsg: AIMessage = { role: 'system', content: this.instructions }
    const chatMessages: AIMessage[] = [
      systemMsg,
      ...messages.map((m) => ({ role: m.role as AIMessage['role'], content: m.content })),
    ]
    yield* this.provider.chatStream(chatMessages, { model: this.model })
  }

  /** Attempt to parse a tool call from the assistant's response content. */
  private parseToolCall(content: string): { name: string; args: Record<string, unknown> } | null {
    // Try function_call JSON block
    const fnMatch = content.match(/```json\s*\n?\s*(\{[\s\S]*?"name"[\s\S]*?\})\s*\n?\s*```/)
    if (fnMatch?.[1]) {
      try {
        const parsed = JSON.parse(fnMatch[1])
        if (parsed.name) return { name: parsed.name, args: parsed.arguments || {} }
      } catch {
        /* not valid JSON */
      }
    }
    // Try inline tool call format: [TOOL:name]{"args"}
    const inlineMatch = content.match(/\[TOOL:(\w+)\]\s*(\{.*?\})/)
    if (inlineMatch) {
      try {
        const name = inlineMatch[1]
        const argsRaw = inlineMatch[2]
        if (name === undefined || argsRaw === undefined) return null
        return { name, args: JSON.parse(argsRaw) }
      } catch {
        /* not valid JSON */
      }
    }
    return null
  }
}
