<script lang="ts">
  import { aiChat, getServiceRoleKey } from '../lib/api'

  let prompt = $state('')
  let messages = $state<Array<{ role: string; content: string }>>([])
  let loading = $state(false)
  let useStudio = $state(false)
  let studioUrl = $state('')

  const token = $derived(getServiceRoleKey())

  $effect(() => {
    // Try to detect Mastra Studio — if it's running, use the iframe
    const studio = localStorage.getItem('mastra-studio-url') || 'http://127.0.0.1:3443'
    fetch(`${studio}/api/health`).then((r) => {
      if (r.ok) { useStudio = true; studioUrl = studio }
    }).catch(() => { useStudio = false })
  })

  async function send() {
    if (!prompt.trim()) return
    loading = true
    messages = [...messages, { role: 'user', content: prompt }]
    try {
      const data = await aiChat(messages)
      const reply = data?.choices?.[0]?.message?.content || data?.message || '[No response]'
      messages = [...messages, { role: 'assistant', content: reply }]
    } catch {
      messages = [...messages, { role: 'assistant', content: 'Error: AI backend unavailable.' }]
    }
    prompt = ''
    loading = false
  }
</script>

<div>
  <div class="flex items-center justify-between mb-lg">
    <h2 style="margin: 0;">AI Playground</h2>
    <div class="flex items-center gap-sm">
      {#if useStudio}
        <span class="chip" style="font-size: 12px;">● Mastra Studio</span>
      {/if}
      <button class="btn-ghost" style="height: 28px; padding: 2px 12px; font-size: 11px;"
        onclick={() => {
          const url = prompt('Mastra Studio URL:', studioUrl || 'http://127.0.0.1:3443')
          if (url) { localStorage.setItem('mastra-studio-url', url); studioUrl = url; useStudio = true }
        }}>Configure</button>
    </div>
  </div>

  {#if useStudio}
    <iframe src={studioUrl} style="width: 100%; height: calc(100vh - 140px); border: 1px solid var(--border); border-radius: var(--radius-none);"
      title="Mastra Studio" />
  {:else}
    <div class="card" style="max-width: 800px;">
      <div style="margin-bottom: var(--space-md); min-height: 200px; max-height: 400px; overflow-y: auto;">
        {#if messages.length === 0}
          <p style="color: var(--text-muted); text-align: center; padding: var(--space-xl);">
            No messages yet. The AI backend is running in mock mode — install Mastra for full agent capabilities.
          </p>
        {/if}
        {#each messages as msg}
          <div style="margin-bottom: var(--space-md); padding: var(--space-md); border: 1px solid var(--border);
            background: {msg.role === 'user' ? 'var(--char)' : 'var(--surface)'};">
            <div class="label" style="margin-bottom: 4px;">{msg.role === 'user' ? 'You' : 'AI'}</div>
            <div style="font-size: 14px; line-height: 1.6; white-space: pre-wrap;">{msg.content}</div>
          </div>
        {/each}
        {#if loading}
          <div style="color: var(--text-muted); padding: var(--space-sm);">Thinking…</div>
        {/if}
      </div>
      <div style="display: flex; gap: var(--space-sm);">
        <input class="input" style="flex: 1;" bind:value={prompt} placeholder="Ask anything…"
          onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' && !loading) send() }} />
        <button class="btn-primary" style="height: 44px;" disabled={loading || !prompt.trim()} onclick={send}>
          Send
        </button>
      </div>
    </div>
  {/if}
</div>
