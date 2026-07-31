<script lang="ts">
  import { getLogs } from '../lib/api'
  import Button from '../components/Button.svelte'

  let entries = $state<Array<{ id: string; level: number; message: string; created: string }>>([])
  let loading = $state(true)
  let error = $state('')
  let page = $state(1)
  let autoRefresh = $state(true)
  let filter = $state('')

  async function load() {
    loading = true; error = ''
    try {
      const result = await getLogs({ page, perPage: 100 })
      if (result.data) entries = result.data.items ?? []
      else if (result.error) error = result.error.message
    } catch (e: any) { error = e.message }
    loading = false
  }

  $effect(() => { load() })

  $effect(() => {
    if (!autoRefresh) return
    const i = setInterval(load, 3000)
    return () => clearInterval(i)
  })

  function levelLabel(level: number): string {
    if (level <= 1) return 'ERR'
    if (level <= 2) return 'WARN'
    if (level <= 3) return 'INFO'
    return 'DBG'
  }

  function levelColor(level: number): string {
    if (level <= 1) return '#e0a3a3'
    if (level <= 2) return '#e0c46e'
    if (level <= 3) return '#a7e0c2'
    return '#9aa0a6'
  }

  const filtered = $derived(filter ? entries.filter((e) => e.message.toLowerCase().includes(filter.toLowerCase())) : entries)
</script>

<div>
  <div class="flex items-center justify-between mb-md">
    <div>
      <h2 style="margin: 0;">Logs</h2>
      <p style="color: var(--text-muted); font-size: 12px; margin-top: 2px;">
        {entries.length} entries · auto-refresh every 3s
      </p>
    </div>
    <div class="flex gap-sm items-center">
      <input class="input input-sm" style="width: 200px;" placeholder="Filter…" bind:value={filter} />
      <Button variant="ghost" size="sm" onclick={load}>↻</Button>
      <label style="font-size: 12px; color: var(--text-secondary); cursor: pointer; display: flex; align-items: center; gap: 4px;">
        <input type="checkbox" bind:checked={autoRefresh} /> Live
      </label>
    </div>
  </div>

  {#if error}<div class="toast toast-error" style="margin-bottom: var(--space-md);">{error}</div>{/if}

  <div class="card" style="font-family: var(--font-mono); font-size: 12px; max-height: calc(100vh - 160px); overflow-y: auto; padding: 0;">
    {#if loading && entries.length === 0}
      <div style="padding: var(--space-lg);">{#each Array(10) as _}<div class="skeleton" style="height: 20px; margin-bottom: 4px;"></div>{/each}</div>
    {:else if entries.length === 0}
      <div style="text-align: center; padding: var(--space-xl); color: var(--text-muted);">No log entries yet. Make a request to trigger logging.</div>
    {:else}
      {#each filtered as e (e.id)}
        <div style="display: flex; gap: var(--space-sm); padding: 4px 12px; border-bottom: 1px solid var(--border); align-items: baseline;">
          <span style="color: var(--text-muted); font-size: 10px; width: 80px; flex-shrink: 0;">{e.created ? new Date(e.created).toLocaleTimeString() : ''}</span>
          <span style="color: {levelColor(e.level)}; font-weight: 600; font-size: 10px; width: 36px; flex-shrink: 0;">{levelLabel(e.level)}</span>
          <span style="color: var(--text-secondary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{e.message}</span>
        </div>
      {/each}
    {/if}
  </div>
</div>
