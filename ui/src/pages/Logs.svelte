<script lang="ts">
  import { getLogs } from '../lib/api'
  import Button from '../components/Button.svelte'

  let entries = $state<Array<{ id: string; level: number; message: string; data: Record<string, unknown>; created: string }>>([])
  let loading = $state(true)
  let error = $state('')
  let page = $state(1)
  let perPage = $state(50)
  let filterLevel = $state<number | null>(null)
  let filterPath = $state('')
  let autoRefresh = $state(false)

  async function load() {
    loading = true; error = ''
    const result = await getLogs({ page, perPage })
    if (result.data) {
      entries = result.data.items ?? []
    } else if (result.error) {
      error = result.error.message
    }
    loading = false
  }

  $effect(() => { load() })
  $effect(() => {
    if (!autoRefresh) return
    const interval = setInterval(load, 5000)
    return () => clearInterval(interval)
  })

  function levelLabel(level: number): string {
    if (level <= 1) return 'ERROR'
    if (level <= 2) return 'WARN'
    if (level <= 3) return 'INFO'
    return 'DEBUG'
  }

  function levelColor(level: number): string {
    if (level <= 1) return 'var(--danger)'
    if (level <= 2) return '#e0c46e'
    if (level <= 3) return 'var(--lichen)'
    return 'var(--text-muted)'
  }
</script>

<div>
  <div class="flex items-center justify-between mb-lg">
    <div>
      <h2 style="margin: 0;">Logs</h2>
      <p class="label" style="margin-top: 4px;">Server-side request logs</p>
    </div>
    <div class="flex gap-sm items-center">
      <label style="display: flex; align-items: center; gap: 4px; font-size: 13px; color: var(--text-secondary); cursor: pointer;">
        <input type="checkbox" bind:checked={autoRefresh} />
        Auto-refresh
      </label>
      <Button variant="ghost" size="sm" onclick={load}>
        ↻ Refresh
      </Button>
    </div>
  </div>

  {#if error}<div class="toast toast-error" style="margin-bottom: var(--space-md);">{error}</div>{/if}

  <div class="flex gap-sm mb-md">
    <select
      style="font-family:var(--font-ui);font-size:13px;padding:4px 8px;background:var(--bg);color:var(--text);border:1px solid var(--border);"
      onchange={(e: Event) => { filterLevel = (e.target as HTMLSelectElement).value ? Number((e.target as HTMLSelectElement).value) : null; page = 1 }}
    >
      <option value="">All Levels</option>
      <option value="1">ERROR</option>
      <option value="2">WARN</option>
      <option value="3">INFO</option>
      <option value="4">DEBUG</option>
    </select>
    <input class="input input-sm" style="width: 200px;" placeholder="Filter path…" bind:value={filterPath}
      oninput={() => { page = 1 }} />
  </div>

  {#if loading}
    <div class="card" style="padding: var(--space-lg);">
      {#each Array(8) as _}<div class="skeleton" style="height: 24px; margin-bottom: 6px;"></div>{/each}
    </div>
  {:else if entries.length === 0}
    <div class="card" style="text-align: center; padding: var(--space-xl);">
      <p style="color: var(--text-secondary);">No log entries found</p>
    </div>
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th style="width: 60px;">Level</th>
            <th>Message</th>
            <th style="width: 160px;">Time</th>
          </tr>
        </thead>
        <tbody>
          {#each entries as entry}
            <tr>
              <td>
                <span style="color: {levelColor(entry.level)}; font-weight: 600; font-size: 11px;">
                  {levelLabel(entry.level)}
                </span>
              </td>
              <td><code style="font-size: 12px;">{entry.message}</code></td>
              <td style="font-size: 12px; color: var(--text-muted);">{new Date(entry.created).toLocaleString()}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  <!-- Pagination -->
  <div class="flex items-center justify-between" style="margin-top: var(--space-md);">
    <span style="font-size: 13px; color: var(--text-secondary);">Page {page}</span>
    <div class="flex gap-sm">
      <Button variant="icon" size="sm" disabled={page <= 1} onclick={() => { page-- }}>←</Button>
      <Button variant="icon" size="sm" onclick={() => { page++ }}>→</Button>
    </div>
  </div>
</div>
