<script lang="ts">
  import { getMetrics } from '../lib/api'

  let metrics = $state<any>(null)
  let loading = $state(true)

  $effect(() => {
    getMetrics().then((r) => {
      if (r.data) metrics = r.data
      loading = false
    }).catch(() => { loading = false })
  })
</script>

<div>
  <h2 style="margin-bottom: var(--space-lg);">Metrics</h2>

  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--space-md); margin-bottom: var(--space-lg);">
    <div class="card" style="text-align: center;">
      <div class="label" style="margin-bottom: var(--space-sm);">Uptime</div>
      <div style="font-family: var(--font-mono); font-size: 32px; color: var(--lichen);">
        {loading ? '—' : metrics?.uptime ?? '—'}
      </div>
    </div>
    <div class="card" style="text-align: center;">
      <div class="label" style="margin-bottom: var(--space-sm);">Requests</div>
      <div style="font-family: var(--font-mono); font-size: 32px; color: var(--text);">
        {loading ? '—' : metrics?.requests?.total ?? '—'}
      </div>
    </div>
    <div class="card" style="text-align: center;">
      <div class="label" style="margin-bottom: var(--space-sm);">Avg Latency</div>
      <div style="font-family: var(--font-mono); font-size: 32px; color: var(--text);">
        {loading ? '—' : metrics?.latency?.avg ? `${metrics.latency.avg}ms` : '—'}
      </div>
    </div>
    <div class="card" style="text-align: center;">
      <div class="label" style="margin-bottom: var(--space-sm);">Error Rate</div>
      <div style="font-family: var(--font-mono); font-size: 32px; color: {metrics?.errorRate > 1 ? 'var(--danger)' : 'var(--lichen)'};">
        {loading ? '—' : metrics?.errorRate ? `${metrics.errorRate}%` : '—'}
      </div>
    </div>
  </div>

  {#if loading}
    <div class="card" style="padding: var(--space-lg);">
      {#each Array(3) as _}<div class="skeleton" style="height: 40px; margin-bottom: 8px;"></div>{/each}
    </div>
  {:else}
    <div class="card">
      <div class="label mb-sm">Raw Metrics</div>
      <pre style="font-family: var(--font-mono); font-size: 12px; color: var(--text-secondary); overflow-x: auto;
        background: var(--char); padding: var(--space-md); border: 1px solid var(--border); max-height: 400px;">
{JSON.stringify(metrics, null, 2)}</pre>
    </div>
  {/if}
</div>
