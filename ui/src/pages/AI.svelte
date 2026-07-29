<script lang="ts">
import { aiChat } from '../lib/api'

let prompt = $state('')
let response = $state('')
let loading = $state(false)
let messages = $state<Array<{ role: string; content: string }>>([])

async function send() {
  if (!prompt.trim()) return
  loading = true
  messages = [...messages, { role: 'user', content: prompt }]
  try {
    const data = await aiChat(messages)
    const reply = data?.choices?.[0]?.message?.content || '[No response]'
    messages = [...messages, { role: 'assistant', content: reply }]
    response = reply
  } catch {
    response = 'Error: Failed to get AI response'
  }
  prompt = ''
  loading = false
}
</script>

<div>
  <h2 style="font-size: 1.5rem; margin-bottom: 2rem;">AI Playground</h2>

  <div style="background: var(--surface); border-radius: 0.75rem; border: 1px solid var(--border); padding: 2rem; max-width: 800px;">
    <div style="margin-bottom: 1rem; min-height: 200px; max-height: 400px; overflow-y: auto;">
      {#each messages as msg}
        <div style="margin-bottom: 1rem; padding: 0.75rem; border-radius: 0.5rem; background: {msg.role === 'user' ? 'var(--bg)' : '#eef2ff'};">
          <div style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 0.25rem;">
            {msg.role === 'user' ? 'You' : 'AI'}
          </div>
          <div>{msg.content}</div>
        </div>
      {/each}
      {#if loading}
        <div style="color: var(--text-secondary); font-style: italic;">Thinking...</div>
      {/if}
    </div>

    <div style="display: flex; gap: 0.5rem;">
      <input
        type="text"
        bind:value={prompt}
        placeholder="Ask anything..."
        style="flex: 1; padding: 0.625rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--bg); color: var(--text);"
        onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' && !loading) send() }}
      />
      <button
        onclick={send}
        disabled={loading || !prompt.trim()}
        style="padding: 0.625rem 1.5rem; background: var(--primary); color: white; border: none; border-radius: 0.5rem; cursor: pointer;"
      >
        Send
      </button>
    </div>
  </div>
</div>
