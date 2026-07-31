<script lang="ts">
  import { getLogs } from '../lib/api'
  import Button from '../components/Button.svelte'

  let entries = $state<Array<{ id: string; level: number; message: string; data: string }>>([])
  let loading = $state(true)
  let error = $state('')
  let paused = $state(false)
  let filter = $state('')
  let scrollEl = $state<HTMLDivElement | null>(null)
  let autoScroll = $state(true)

  async function load() {
    loading = true; error = ''
    try {
      const result = await getLogs({ page: 1, perPage: 200 })
      if (result.data) entries = result.data.items ?? []
    } catch (e: any) { error = e.message }
    loading = false
  }

  function parseData(data: string): { status: number; duration_ms: number; method: string; path: string } | null {
    try { return JSON.parse(data) } catch { return null }
  }

  function statusColor(code: number): string {
    if (code >= 500) return '#e0a3a3'
    if (code >= 400) return '#e0c46e'
    if (code >= 300) return '#9dc4e0'
    return '#a7e0c2'
  }

  function methodColor(method: string): string {
    switch (method) {
      case 'GET': return '#a7e0c2'
      case 'POST': return '#e0c46e'
      case 'PATCH': case 'PUT': return '#9dc4e0'
      case 'DELETE': return '#e0a3a3'
      default: return '#9aa0a6'
    }
  }

  $effect(() => { load() })
  $effect(() => {
    if (paused) return
    const i = setInterval(load, 2000)
    return () => clearInterval(i)
  })
  $effect(() => {
    if (autoScroll && scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight
  })

  const filtered = $derived(filter
    ? entries.filter((e) => e.message.toLowerCase().includes(filter.toLowerCase()) || e.data.toLowerCase().includes(filter.toLowerCase()))
    : entries)
</script>

<div style="display: flex; flex-direction: column; height: calc(100vh - 80px);">
  <div class="flex items-center justify-between mb-sm">
    <div class="flex items-center gap-sm">
      <h2 style="margin: 0;">Logs</h2>
      <span class="chip" style="font-size: 10px;">{entries.length}</span>
      {#if paused}<span class="chip chip-muted" style="font-size: 10px;">PAUSED</span>{/if}
    </div>
    <div class="flex items-center gap-sm">
      <input class="input input-sm" style="width: 180px;" placeholder="Filter…" bind:value={filter} />
      <Button variant="ghost" size="sm" onclick={() => { paused = !paused }}>{paused ? '▶' : '⏸'}</Button>
      <Button variant="ghost" size="sm" onclick={load}>↻</Button>
    </div>
  </div>

  {#if error}<div class="toast toast-error" style="margin-bottom: var(--space-sm);">{error}</div>{/if}

  <div bind:this={scrollEl}
    onscroll={() => { if (scrollEl) autoScroll = scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 40 }}
    style="flex: 1; overflow-y: auto; background: var(--char); border: 1px solid var(--border);
      font-family: var(--font-mono); font-size: 11px; line-height: 1.7;"
  >
    {#if loading && entries.length === 0}
      <div style="padding: var(--space-lg); color: var(--text-muted);">Loading…</div>
    {:else if entries.length === 0}
      <div style="padding: var(--space-xl); color: var(--text-muted); text-align: center;">No entries yet</div>
    {:else}
      {#each filtered as e (e.id)}
        {@const info = parseData(e.data)}
        <div style="display: flex; gap: var(--space-sm); padding: 2px 12px; align-items: baseline;
          border-bottom: 1px solid rgba(255,255,255,0.03);">
          <span style="color: var(--shadow); font-size: 10px; width: 72px; flex-shrink: 0;">{e.id.slice(-8)}</span>
          {#if info}
            <span style="color: {methodColor(info.method)}; width: 44px; flex-shrink: 0; font-weight: 600;">{info.method}</span>
            <span style="color: var(--text-secondary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{info.path}</span>
            <span style="color: {statusColor(info.status)}; width: 40px; flex-shrink: 0; text-align: right;">{info.status}</span>
            <span style="color: var(--shadow); width: 48px; flex-shrink: 0; text-align: right;">{info.duration_ms}ms</span>
          {:else}
            <span style="color: var(--text-secondary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{e.message}</span>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>
