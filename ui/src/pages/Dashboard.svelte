<script lang="ts">
import { health } from '../lib/api'

let data = $state<any>(null)

$effect(() => {
  health()
    .then((r) => {
      data = r
    })
    .catch(() => {
      data = { db: 'error', storage: 'error' }
    })
})
</script>

<div>
  <h2 style="font-size: 1.5rem; margin-bottom: 2rem;">Dashboard</h2>

  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem;">
    <div style="background: var(--surface); padding: 1.5rem; border-radius: 0.75rem; border: 1px solid var(--border);">
      <div style="font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 0.5rem;">Database</div>
      <div style="font-size: 1.5rem; font-weight: 700;">{data?.db || '—'}</div>
    </div>
    <div style="background: var(--surface); padding: 1.5rem; border-radius: 0.75rem; border: 1px solid var(--border);">
      <div style="font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 0.5rem;">Storage</div>
      <div style="font-size: 1.5rem; font-weight: 700;">{data?.storage || '—'}</div>
    </div>
    <div style="background: var(--surface); padding: 1.5rem; border-radius: 0.75rem; border: 1px solid var(--border);">
      <div style="font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 0.5rem;">Auth</div>
      <div style="font-size: 1.5rem; font-weight: 700;">better-auth</div>
    </div>
    <div style="background: var(--surface); padding: 1.5rem; border-radius: 0.75rem; border: 1px solid var(--border);">
      <div style="font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 0.5rem;">Version</div>
      <div style="font-size: 1.5rem; font-weight: 700;">v0.2.0</div>
    </div>
  </div>

  <div style="margin-top: 2rem;">
    <h3 style="font-size: 1rem; margin-bottom: 1rem;">Quick Start</h3>
    <div style="background: var(--surface); padding: 1.5rem; border-radius: 0.75rem; border: 1px solid var(--border);">
      <p style="color: var(--text-secondary); margin-bottom: 0.5rem;">Your backend is running at <code style="background: var(--bg); padding: 0.125rem 0.5rem; border-radius: 0.25rem;">{window.location.origin}</code></p>
      <ul style="list-style: none; padding: 0;">
        <li style="margin-bottom: 0.5rem;">📊 <strong>REST API:</strong> <code>/rest/v1/:table</code></li>
        <li style="margin-bottom: 0.5rem;">🔐 <strong>Auth:</strong> <code>/auth/v1/*</code></li>
        <li style="margin-bottom: 0.5rem;">📦 <strong>Storage:</strong> <code>/storage/v1/*</code></li>
        <li style="margin-bottom: 0.5rem;">⚡ <strong>Edge Functions:</strong> <code>/api/functions/v1/*</code></li>
        <li style="margin-bottom: 0.5rem;">🤖 <strong>AI:</strong> <code>/api/mastra/*</code></li>
      </ul>
    </div>
  </div>
</div>
