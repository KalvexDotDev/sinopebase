// ---------------------------------------------------------------------------
// Mock AI Provider — for development/testing without an API key
// ---------------------------------------------------------------------------

import type { AIProvider } from './provider'

/**
 * Create a mock AI provider that echoes back the last user message.
 * Used when no API key is configured.
 */
export function createMockProvider(): AIProvider {
  return {
    displayName: () => 'mock',

    async chat(messages) {
      return {
        id: crypto.randomUUID(),
        model: 'mock',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant' as const,
              content: `[Mock AI] Echo: ${messages[messages.length - 1]?.content || 'No input'}`,
            },
            finishReason: 'stop' as const,
          },
        ],
      }
    },

    async *chatStream(messages) {
      const content = `[Mock AI] Echo: ${messages[messages.length - 1]?.content || 'No input'}`
      yield {
        id: crypto.randomUUID(),
        model: 'mock',
        choices: [{ index: 0, delta: { role: 'assistant', content }, finishReason: 'stop' }],
      }
    },

    async embeddings(texts) {
      return {
        model: 'mock-embedding',
        data: texts.map((_, i) => ({
          index: i,
          embedding: new Array(128).fill(0).map(() => Math.random()),
        })),
      }
    },
  }
}
