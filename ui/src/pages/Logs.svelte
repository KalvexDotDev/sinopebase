<script lang="ts">
  import { getLogs } from '../lib/api'
  import Button from '../components/Button.svelte'

  let entries = $state<Array<{ id: string; level: number; message: string; data: string }>>([])
  let loading = $state(true)
  let paused = $state(false)
  let filter = $state('')
  let scrollEl = $state<HTMLDivElement | null>(null)
  let atBottom = $state(true)

  async function load() {
    try { const result = await getLogs({ page: 1, perPage: 500 }); if (result.data) entries = result.data.items ?? [] } catch {}
    loading = false
  }

  function info(data: string) { try { return JSON.parse(data) as { status: number; duration_ms: number; method: string; path: string } } catch { return null } }
  function lvlColor(l: number) { if (l <= 1) return 'var(--danger)'; if (l <= 2) return '#e0c46e'; return 'var(--lichen)' }
  function sColor(c: number) { if (c >= 500) return 'var(--danger)'; if (c >= 400) return '#e0c46e'; return 'var(--lichen)' }
  function mColor(m: string) { if (m === 'GET') return 'var(--lichen)'; if (m === 'POST') return '#e0c46e'; if (m === 'DELETE') return 'var(--danger)'; if (m === 'PATCH' || m === 'PUT') return '#9dc4e0'; return 'var(--fog)' }
  function badge(p: string) { if (!p) return '—'; const s = p.split('/').filter(Boolean); return s[0] === 'api' ? s.slice(0,3).join('/') : s[0] === 'rest' ? `rest/${s[1]||''}` : s[0] === 'auth' ? `auth` : s[0] === 'storage' ? `storage` : s[0] || 'root' }

  $effect(() => { load() })
  $effect(() => { if (paused) return; const i = setInterval(load, 2000); return () => clearInterval(i) })
  $effect(() => { if (atBottom && scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight })

  function onScroll() { if (scrollEl) atBottom = scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 30 }
  function toBottom() { if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight }

  const filtered = $derived(filter ? entries.filter((e) => (e.message + e.data).toLowerCase().includes(filter.toLowerCase())) : entries)
</script>

<div style="display: flex; flex-direction: column; height: calc(100vh - 80px);">
  <div class="flex items-center gap-sm mb-sm" style="flex-wrap: wrap;">
    <h2 style="margin: 0; margin-right: var(--space-sm);">Logs</h2>
    <span class="chip" style="font-size: 10px;">{entries.length}</span>
    {#if paused}<span class="chip chip-muted" style="font-size: 10px;">PAUSED</span>{/if}
    <div style="flex: 1;"></div>
    <input class="input input-sm" style="width: 220px;" placeholder="Filter…" bind:value={filter} />
    <Button variant="ghost" size="sm" onclick={() => { paused = !paused; if (!paused) toBottom() }}>{paused ? '▶' : '⏸'}</Button>
    <Button variant="ghost" size="sm" onclick={load}>↻</Button>
  </div>

  <div style="position: relative; flex: 1; overflow: hidden;">
    <div bind:this={scrollEl} {onScroll}
      style="height: 100%; overflow-y: auto; background: var(--char); border: 1px solid var(--border);
        font-family: var(--font-mono); font-size: 11px; line-height: 1.8;">
      {#if loading && entries.length === 0}
        <div style="padding: var(--space-lg); color: var(--text-muted);">Loading…</div>
      {:else if entries.length === 0}
        <div style="padding: var(--space-xl); color: var(--text-muted); text-align: center;">No entries</div>
      {:else}
        {#each filtered as e (e.id)}
          {@const d = info(e.data)}
          <div style="display: flex; gap: 8px; padding: 2px 12px; align-items: baseline; border-bottom: 1px solid rgba(255,255,255,0.025);">
            <span style="width: 6px; height: 6px; border-radius: 50%; background: {lvlColor(e.level)}; flex-shrink: 0; margin-top: 5px;"></span>
            <span style="color: var(--shadow); font-size: 10px; min-width: 75px; flex-shrink: 0;">{new Date(e.created).toLocaleTimeString()}</span>
            {#if d}
              <span style="color: {mColor(d.method)}; font-weight: 600; min-width: 38px; flex-shrink: 0;">{d.method}</span>
              <span style="color: var(--text-secondary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{d.path}</span>
              <span style="color: {sColor(d.status)}; min-width: 32px; text-align: right;">{d.status}</span>
              <span style="color: var(--shadow); min-width: 44px; text-align: right;">{d.duration_ms}ms</span>
            {:else}
              <span style="color: var(--text-secondary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{e.message}</span>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
    {#if !atBottom}
      <button onclick={toBottom}
        style="position: absolute; bottom: 12px; right: 16px; width: 32px; height: 32px; border-radius: 50%;
          background: var(--surface); border: 1px solid var(--border); color: var(--text-secondary);
          cursor: pointer; font-size: 14px; box-shadow: 0 2px 8px rgba(0,0,0,0.4);"
        title="Scroll to bottom">↓</button>
    {/if}
  </div>
</div>
