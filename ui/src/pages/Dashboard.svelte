<script lang="ts">
  import { health } from '../lib/api'
  import { getServiceRoleKey } from '../lib/api'

  let data = $state<any>(null)
  let loading = $state(true)

  $effect(() => {
    const token = getServiceRoleKey()
    fetch(window.location.origin + '/api/health', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => r.json())
      .then((d) => { data = d; loading = false })
      .catch(() => { data = { db: 'error', storage: 'error' }; loading = false })
  })
</script>

<div>
  <h2 style="margin-bottom: var(--space-lg);">Dashboard</h2>

  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: var(--space-md); margin-bottom: var(--space-xl);">
    <!-- Database card -->
    <div class="card">
      <div class="label" style="margin-bottom: var(--space-sm);">Database</div>
      <div style="font-family: var(--font-mono); font-size: 28px; font-weight: 500; color: {data?.db === 'postgresql' ? 'var(--lichen)' : 'var(--text-secondary)'};">
        {#if loading}<span class="skeleton" style="display: inline-block; width: 80px; height: 28px;"></span>{:else}{data?.db || '—'}{/if}
      </div>
    </div>

    <!-- Storage card -->
    <div class="card">
      <div class="label" style="margin-bottom: var(--space-sm);">Storage</div>
      <div style="font-family: var(--font-mono); font-size: 28px; font-weight: 500; color: {data?.storage === 's3' ? 'var(--lichen)' : 'var(--text-secondary)'};">
        {#if loading}<span class="skeleton" style="display: inline-block; width: 60px; height: 28px;"></span>{:else}{data?.storage || 'local'}{/if}
      </div>
    </div>

    <!-- Auth card -->
    <div class="card">
      <div class="label" style="margin-bottom: var(--space-sm);">Auth</div>
      <div style="font-family: var(--font-mono); font-size: 28px; font-weight: 500; color: var(--lichen);">
        better-auth
      </div>
    </div>

    <!-- TLS card -->
    <div class="card">
      <div class="label" style="margin-bottom: var(--space-sm);">TLS</div>
      <div style="font-family: var(--font-mono); font-size: 28px; font-weight: 500; color: {data?.tls ? 'var(--lichen)' : 'var(--text-muted)'};">
        {data?.tls ? 'Active' : 'Off'}
      </div>
    </div>
  </div>

  <div class="card">
    <h3 style="margin: 0 0 var(--space-md) 0;">API Endpoints</h3>
    <div style="display: grid; gap: var(--space-sm);">
      <div style="display: flex; align-items: center; gap: var(--space-sm); font-family: var(--font-mono); font-size: 12px; color: var(--text-secondary);">
        <span class="chip">REST</span> {window.location.origin}/rest/v1/:table
      </div>
      <div style="display: flex; align-items: center; gap: var(--space-sm); font-family: var(--font-mono); font-size: 12px; color: var(--text-secondary);">
        <span class="chip">Auth</span> {window.location.origin}/auth/v1/*
      </div>
      <div style="display: flex; align-items: center; gap: var(--space-sm); font-family: var(--font-mono); font-size: 12px; color: var(--text-secondary);">
        <span class="chip">Storage</span> {window.location.origin}/storage/v1/*
      </div>
      <div style="display: flex; align-items: center; gap: var(--space-sm); font-family: var(--font-mono); font-size: 12px; color: var(--text-secondary);">
        <span class="chip">Realtime</span> ws://{window.location.host}/realtime/v1/websocket
      </div>
    </div>
  </div>
</div>
