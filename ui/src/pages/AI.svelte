<script lang="ts">
  import { getServiceRoleKey } from '../lib/api'
  import Button from '../components/Button.svelte'
  import Modal from '../components/Modal.svelte'

  let agents = $state<Array<{ id: string; name: string; description: string; instructions: string; model: string }>>([])
  let selectedId = $state('')
  let messages = $state<Array<{ role: string; content: string }>>([])
  let prompt = $state('')
  let loading = $state(false)
  let editingId = $state('')
  let editForm = $state({ name: '', description: '', instructions: '', model: 'deepseek-chat' })
  let editSubmitting = $state(false)
  let editError = $state('')
  let showCreate = $state(false)

  const token = $derived(getServiceRoleKey())
  const origin = window.location.origin
  function headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) h['Authorization'] = `Bearer ${token}`
    return h
  }

  const selected = $derived(agents.find((a) => a.id === selectedId))

  async function loadAgents() {
    try {
      const res = await fetch(`${origin}/api/mastra/agents`, { headers: headers() })
      const data = await res.json()
      if (Array.isArray(data?.data)) {
        agents = data.data
        if (agents.length > 0 && !selectedId) selectedId = agents[0]!.id
      }
    } catch { /* no agents */ }
  }

  async function send() {
    if (!prompt.trim()) return
    loading = true
    messages = [...messages, { role: 'user', content: prompt }]
    try {
      const endpoint = selectedId
        ? `${origin}/api/mastra/agents/${selectedId}/chat`
        : `${origin}/api/mastra/chat`
      const res = await fetch(endpoint, { method: 'POST', headers: headers(), body: JSON.stringify({ messages: messages.map((m) => ({ role: m.role, content: m.content })) }) })
      const data = await res.json()
      if (res.ok) {
        const content = data?.choices?.[0]?.message?.content || data?.message?.content || data?.message || data?.response || JSON.stringify(data)
        messages = [...messages, { role: 'assistant', content: String(content) }]
      } else {
        messages = [...messages, { role: 'assistant', content: `Error: ${data?.error || res.status}` }]
      }
    } catch (e: any) {
      messages = [...messages, { role: 'assistant', content: `Error: ${e.message}` }]
    }
    prompt = ''
    loading = false
  }

  function openEdit(id: string) {
    const a = agents.find((x) => x.id === id)
    if (!a) return
    editingId = id; editForm = { name: a.name, description: a.description, instructions: a.instructions, model: a.model }; editError = ''
  }

  async function saveEdit() {
    editSubmitting = true; editError = ''
    try {
      const res = await fetch(`${origin}/api/mastra/agents/${editingId}`, {
        method: 'PATCH', headers: headers(), body: JSON.stringify(editForm),
      })
      if (res.ok) { editingId = ''; loadAgents() }
      else { const j = await res.json().catch(() => ({})); editError = j.message || `Error ${res.status}` }
    } catch (e: any) { editError = e.message }
    editSubmitting = false
  }

  async function deleteAgent(id: string) {
    if (!confirm(`Delete agent "${agents.find((a) => a.id === id)?.name}"?`)) return
    await fetch(`${origin}/api/mastra/agents/${id}`, { method: 'DELETE', headers: headers() })
    if (selectedId === id) selectedId = agents[0]?.id ?? ''
    loadAgents()
  }

  async function createAgent() {
    editSubmitting = true; editError = ''
    const id = crypto.randomUUID()
    try {
      const res = await fetch(`${origin}/api/mastra/agents`, {
        method: 'POST', headers: headers(), body: JSON.stringify({ id, ...editForm }),
      })
      if (res.ok) { showCreate = false; editForm = { name: '', description: '', instructions: '', model: 'deepseek-chat' }; loadAgents() }
      else { const j = await res.json().catch(() => ({})); editError = j.message || `Error ${res.status}` }
    } catch (e: any) { editError = e.message }
    editSubmitting = false
  }

  function openCreate() { showCreate = true; editForm = { name: '', description: '', instructions: '', model: 'deepseek-chat' }; editError = '' }

  $effect(() => { loadAgents() })
  $effect(() => { if (selectedId) messages = [] })
</script>

<div class="flex gap-lg" style="align-items: flex-start; height: calc(100vh - 80px);">
  <!-- Left: Agent sidebar -->
  <nav style="width: 220px; flex-shrink: 0; overflow-y: auto; max-height: 100%;" class="card p-lg">
    <div class="flex items-center justify-between mb-sm">
      <span class="label">Agents</span>
      <Button variant="icon" size="sm" onclick={openCreate}>+</Button>
    </div>
    {#if agents.length === 0}
      <p style="color: var(--text-muted); font-size: 13px;">No agents configured.</p>
      <Button variant="primary" size="sm" onclick={openCreate}><span style="margin-right: 4px;">+</span> Create Agent</Button>
    {:else}
      {#each agents as a (a.id)}
        <div
          onclick={() => { selectedId = a.id }}
          style="display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 8px 10px; cursor: pointer; background: {selectedId === a.id ? 'var(--char)' : 'transparent'}; color: {selectedId === a.id ? 'var(--text)' : 'var(--text-secondary)'}; border-radius: var(--radius-none); margin-bottom: 1px; font-size: 13px;"
        >
          <span style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
            <span style="width: 6px; height: 6px; border-radius: 50%; background: var(--lichen); flex-shrink: 0;"></span>
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{a.name}</span>
          </span>
          <span style="color: var(--text-muted); font-size: 9px; cursor: pointer; padding: 0 2px; flex-shrink: 0;"
            onclick={(e: Event) => { e.stopPropagation(); deleteAgent(a.id) }} title="Delete">✕</span>
        </div>
      {/each}
    {/if}
  </nav>

  <!-- Center: Chat -->
  <div class="flex-1" style="display: flex; flex-direction: column; height: 100%; min-width: 0;">
    {#if !selectedId}
      <div class="card" style="text-align: center; padding: var(--space-2xl); flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;">
        <h3 style="margin-bottom: var(--space-sm);">AI Playground</h3>
        <p style="color: var(--text-secondary); font-size: 14px; margin-bottom: var(--space-lg); max-width: 400px;">
          Select an agent from the sidebar or create a new one. Each agent has its own instructions, model, and tools.
        </p>
        <Button variant="primary" onclick={openCreate}>Create Your First Agent</Button>
      </div>
    {:else}
      <div class="flex items-center justify-between mb-sm">
        <div>
          <span style="font-weight: 600; font-size: 15px;">{selected?.name ?? 'Chat'}</span>
          <span class="chip chip-muted" style="margin-left: 8px; font-size: 10px;">{selected?.model ?? ''}</span>
        </div>
        <div class="flex gap-sm">
          <Button variant="ghost" size="sm" onclick={() => openEdit(selectedId)}>Edit</Button>
          <Button variant="ghost" size="sm" onclick={() => { messages = [] }}>Clear</Button>
        </div>
      </div>
      <!-- Messages -->
      <div class="card" style="flex: 1; overflow-y: auto; margin-bottom: var(--space-md); padding: var(--space-lg);">
        {#if messages.length === 0}
          <p style="color: var(--text-muted); text-align: center; padding: var(--space-xl);">
            Start a conversation with {selected?.name ?? 'the agent'}.<br/>
            <span style="font-size: 13px;">{selected?.instructions ?? 'No instructions configured.'}</span>
          </p>
        {/if}
        {#each messages as msg}
          <div style="margin-bottom: var(--space-md);">
            <div class="label" style="margin-bottom: 4px;">{msg.role === 'user' ? 'You' : selected?.name ?? 'Assistant'}</div>
            <div style="padding: var(--space-md); border: 1px solid var(--border); background: {msg.role === 'user' ? 'var(--char)' : 'var(--surface)'}; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">{msg.content}</div>
          </div>
        {/each}
        {#if loading}<div style="color: var(--text-muted); padding: var(--space-sm);">Thinking…</div>{/if}
      </div>
      <!-- Input -->
      <div style="display: flex; gap: var(--space-sm);">
        <input class="input" style="flex: 1;" bind:value={prompt} placeholder="Type a message…"
          onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' && !loading && prompt.trim()) send() }} />
        <Button variant="primary" disabled={loading || !prompt.trim()} onclick={send}>Send</Button>
      </div>
    {/if}
  </div>

  <!-- Right: Agent details -->
  {#if selected}
    <div style="width: 260px; flex-shrink: 0; overflow-y: auto; max-height: 100%;" class="card p-lg">
      <div class="label" style="margin-bottom: var(--space-sm);">Agent Details</div>
      <div style="display: grid; gap: var(--space-sm); font-size: 13px;">
        <div><span style="color: var(--text-muted);">Model</span><br/><code style="font-size: 12px;">{selected.model}</code></div>
        <div><span style="color: var(--text-muted);">Description</span><br/><span style="color: var(--text-secondary);">{selected.description || '—'}</span></div>
        <div><span style="color: var(--text-muted);">Instructions</span><br/><span style="color: var(--text-secondary); font-size: 12px; white-space: pre-wrap;">{selected.instructions || '—'}</span></div>
      </div>
      <div class="hr" style="margin: var(--space-md) 0;"></div>
      <Button variant="ghost" size="sm" onclick={() => openEdit(selected.id)}>Edit Agent</Button>
      <Button variant="danger" size="sm" onclick={() => deleteAgent(selected.id)}>Delete Agent</Button>
    </div>
  {/if}
</div>

<!-- Edit Agent Modal -->
<Modal title="Edit Agent" open={editingId !== ''} variant="slide" onclose={() => { editingId = '' }}>
  <form style="padding: var(--space-lg); display: flex; flex-direction: column; gap: var(--space-md); overflow-y: auto;"
    onsubmit={(e) => { e.preventDefault(); saveEdit() }}>
    <div><label class="label" style="margin-bottom: 4px;">Name</label>
      <input class="input" bind:value={editForm.name} /></div>
    <div><label class="label" style="margin-bottom: 4px;">Description</label>
      <input class="input" bind:value={editForm.description} placeholder="Short description" /></div>
    <div><label class="label" style="margin-bottom: 4px;">Instructions</label>
      <textarea class="input" style="min-height: 100px; font-size: 13px;" bind:value={editForm.instructions} placeholder="System prompt / instructions"></textarea></div>
    <div><label class="label" style="margin-bottom: 4px;">Model</label>
      <select bind:value={editForm.model} style="width:100%;padding:8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:var(--radius-none);">
        <option value="deepseek-chat">DeepSeek Chat</option>
        <option value="gpt-4o">GPT-4o</option>
        <option value="gpt-4o-mini">GPT-4o Mini</option>
        <option value="claude-sonnet-5">Claude Sonnet 5</option>
      </select></div>
    {#if editError}<div style="color: var(--danger); font-size: 13px;">{editError}</div>{/if}
    <div class="flex gap-sm" style="margin-top: var(--space-md);">
      <Button variant="primary" disabled={editSubmitting} onclick={saveEdit}>{editSubmitting ? 'Saving…' : 'Save'}</Button>
      <Button variant="ghost" onclick={() => { editingId = '' }}>Cancel</Button>
    </div>
  </form>
</Modal>

<!-- Create Agent Modal -->
<Modal title="Create Agent" open={showCreate} variant="slide" onclose={() => { showCreate = false }}>
  <form style="padding: var(--space-lg); display: flex; flex-direction: column; gap: var(--space-md); overflow-y: auto;"
    onsubmit={(e) => { e.preventDefault(); createAgent() }}>
    <div><label class="label" style="margin-bottom: 4px;">Name</label>
      <input class="input" bind:value={editForm.name} placeholder="My Agent" /></div>
    <div><label class="label" style="margin-bottom: 4px;">Description</label>
      <input class="input" bind:value={editForm.description} placeholder="What this agent does" /></div>
    <div><label class="label" style="margin-bottom: 4px;">Instructions</label>
      <textarea class="input" style="min-height: 100px; font-size: 13px;" bind:value={editForm.instructions} placeholder="System prompt"></textarea></div>
    <div><label class="label" style="margin-bottom: 4px;">Model</label>
      <select bind:value={editForm.model} style="width:100%;padding:8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:var(--radius-none);">
        <option value="deepseek-chat">DeepSeek Chat</option>
        <option value="gpt-4o">GPT-4o</option>
        <option value="gpt-4o-mini">GPT-4o Mini</option>
        <option value="claude-sonnet-5">Claude Sonnet 5</option>
      </select></div>
    {#if editError}<div style="color: var(--danger); font-size: 13px;">{editError}</div>{/if}
    <div class="flex gap-sm" style="margin-top: var(--space-md);">
      <Button variant="primary" disabled={editSubmitting} onclick={createAgent}>{editSubmitting ? 'Creating…' : 'Create'}</Button>
      <Button variant="ghost" onclick={() => { showCreate = false }}>Cancel</Button>
    </div>
  </form>
</Modal>
