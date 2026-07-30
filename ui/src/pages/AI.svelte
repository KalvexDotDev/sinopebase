<script lang="ts">
  import { getServiceRoleKey } from '../lib/api'

  let agents = $state<Array<{ id: string; name: string }>>([])
  let selectedAgent = $state('')
  let messages = $state<Array<{ role: string; content: string; toolCalls?: Array<{ name: string; args: unknown; result?: unknown }> }>>([])
  let prompt = $state('')
  let loading = $state(false)
  let showTools = $state(false)
  let tools = $state<Array<{ id: string; name: string; description: string }>>([])

  const token = $derived(getServiceRoleKey())
  const origin = window.location.origin
  function h(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`
    return headers
  }

  async function loadAgents() {
    try {
      const res = await fetch(`${origin}/api/mastra/agents`, { headers: h() })
      const data = await res.json()
      if (data?.data) {
        agents = data.data
        if (agents.length > 0) selectedAgent = agents[0]!.id
      }
    } catch { /* mock mode */ }
  }

  async function loadTools() {
    try {
      const res = await fetch(`${origin}/api/mastra/agents/${selectedAgent}/tools`, { headers: h() })
      const data = await res.json()
      if (Array.isArray(data?.tools)) tools = data.tools
    } catch { tools = [] }
  }

  async function send() {
    if (!prompt.trim()) return
    loading = true
    messages = [...messages, { role: 'user', content: prompt }]
    const body = { messages: messages.map((m) => ({ role: m.role, content: m.content })) }
    try {
      const endpoint = selectedAgent
        ? `${origin}/api/mastra/agents/${selectedAgent}/chat`
        : `${origin}/api/mastra/chat`
      const res = await fetch(endpoint, { method: 'POST', headers: h(), body: JSON.stringify(body) })
      const data = await res.json()
      if (res.ok) {
        const content = data?.choices?.[0]?.message?.content
          || data?.message?.content
          || data?.message
          || data?.response
          || JSON.stringify(data)
        const toolCalls = data?.choices?.[0]?.message?.tool_calls?.map((tc: any) => ({
          name: tc.function?.name ?? tc.name ?? 'unknown',
          args: tc.function?.arguments ?? tc.args ?? {},
          result: null,
        }))
        messages = [...messages, { role: 'assistant', content: String(content), toolCalls }]
      } else {
        messages = [...messages, { role: 'assistant', content: `Error: ${data?.error || res.status}` }]
      }
    } catch (e: any) {
      messages = [...messages, { role: 'assistant', content: `Error: ${e.message}` }]
    }
    prompt = ''
    loading = false
  }

  $effect(() => { loadAgents() })
  $effect(() => { if (selectedAgent) { messages = []; loadTools() } })
</script>

<div class="flex gap-lg" style="align-items: flex-start; height: calc(100vh - 80px);">
  <!-- Agent sidebar -->
  <nav style="width: 220px; flex-shrink: 0; overflow-y: auto;" class="card p-lg">
    <div class="label" style="margin-bottom: var(--space-sm);">Agents</div>
    {#if agents.length === 0}
      <p style="color: var(--text-muted); font-size: 13px;">No agents configured.</p>
      <p style="color: var(--text-muted); font-size: 12px; margin-top: var(--space-sm);">
        Agents use the DeepSeek provider. Create agents in the Mastra plugin config.
      </p>
    {:else}
      {#each agents as a (a.id)}
        <button
          onclick={() => { selectedAgent = a.id; messages = [] }}
          style="display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
            padding: 8px 10px; border: none; margin-bottom: 2px;
            background: {selectedAgent === a.id ? 'var(--char)' : 'transparent'};
            color: {selectedAgent === a.id ? 'var(--text)' : 'var(--text-secondary)'};
            border-radius: var(--radius-none); cursor: pointer; font-size: 13px;">
          <span style="width: 6px; height: 6px; border-radius: 50%; background: var(--lichen);"></span>
          {a.name}
        </button>
      {/each}
    {/if}

    <div class="hr" style="margin: var(--space-md) 0;"></div>

    <button
      onclick={() => { showTools = !showTools }}
      style="display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
        padding: 8px 10px; border: none; background: {showTools ? 'var(--char)' : 'transparent'};
        color: var(--text-secondary); border-radius: var(--radius-none); cursor: pointer; font-size: 13px;"
    >
      <span style="font-size: 11px;">{showTools ? '▾' : '▸'}</span> Tools ({tools.length})
    </button>
    {#if showTools && tools.length > 0}
      <div style="padding: var(--space-xs) 0;">
        {#each tools as tool (tool.id)}
          <div style="padding: 6px 10px; border-bottom: 1px solid var(--border); color: var(--text-secondary); font-size: 12px;"
            title={tool.description}>
            <div style="font-family: var(--font-mono); color: var(--text); font-size: 11px;">{tool.name}</div>
            <div style="color: var(--text-muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{tool.description}</div>
          </div>
        {/each}
      </div>
    {:else if showTools}
      <p style="color: var(--text-muted); font-size: 12px; padding: 6px 10px;">No tools available.</p>
    {/if}
  </nav>

  <!-- Chat area -->
  <div class="flex-1" style="display: flex; flex-direction: column; height: 100%;">
    <div class="flex items-center justify-between mb-md">
      <div>
        <h3 style="margin: 0;">
          {selectedAgent ? agents.find((a) => a.id === selectedAgent)?.name ?? 'Chat' : 'AI Playground'}
        </h3>
        <p style="color: var(--text-muted); font-size: 12px; margin-top: 2px;">
          {agents.length === 0 ? 'Direct chat (no agents configured)' : `${agents.length} agent(s) · powered by DeepSeek`}
        </p>
      </div>
      <button class="btn-ghost" style="height: 28px; padding: 2px 12px; font-size: 11px;"
        onclick={() => { messages = [] }}>Clear</button>
    </div>

    <!-- Messages -->
    <div class="card" style="flex: 1; overflow-y: auto; margin-bottom: var(--space-md); padding: var(--space-lg);">
      {#if messages.length === 0}
        <div style="text-align: center; padding: var(--space-2xl); color: var(--text-muted);">
          <p style="font-size: 17px; margin-bottom: var(--space-sm);">AI Playground</p>
          <p style="font-size: 13px;">
            {agents.length === 0
              ? 'Ask anything — the model responds directly without tool access.'
              : 'Select an agent and start a conversation. Agent responses include tool calls.'}
          </p>
        </div>
      {/if}
      {#each messages as msg, i}
        <div style="margin-bottom: var(--space-md);">
          <div style="font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); margin-bottom: 4px;">
            {msg.role === 'user' ? 'You' : selectedAgent ? agents.find((a) => a.id === selectedAgent)?.name ?? 'Assistant' : 'Assistant'}
          </div>
          <div style="padding: var(--space-md); border: 1px solid var(--border);
            background: {msg.role === 'user' ? 'var(--char)' : 'var(--surface)'};
            font-size: 14px; line-height: 1.6; white-space: pre-wrap;">{msg.content}</div>
          {#if msg.toolCalls?.length}
            {#each msg.toolCalls as tc}
              <div style="margin-top: 4px; padding: var(--space-sm) var(--space-md); border-left: 2px solid var(--lichen);
                background: var(--char); font-size: 12px;">
                <div style="color: var(--lichen); font-family: var(--font-mono);">⚙ {tc.name}</div>
                <pre style="color: var(--text-muted); font-size: 11px; margin-top: 4px; overflow-x: auto;">{JSON.stringify(tc.args, null, 2)}</pre>
                {#if tc.result !== null}
                  <div style="color: var(--text-secondary); margin-top: 4px;">→ {JSON.stringify(tc.result)}</div>
                {/if}
              </div>
            {/each}
          {/if}
        </div>
      {/each}
      {#if loading}
        <div style="color: var(--text-muted); padding: var(--space-sm); font-style: italic;">Thinking…</div>
      {/if}
    </div>

    <!-- Input -->
    <div style="display: flex; gap: var(--space-sm);">
      <input class="input" style="flex: 1;" bind:value={prompt} placeholder="Type a message…"
        onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' && !loading && prompt.trim()) send() }} />
      <button class="btn-primary" style="height: 44px;" disabled={loading || !prompt.trim()} onclick={send}>
        Send
      </button>
    </div>
  </div>
</div>
