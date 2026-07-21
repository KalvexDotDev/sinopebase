<script lang="ts">
  import { listFunctions } from '../lib/api'

  let functions = $state<any[]>([])
  let loading = $state(true)

  $effect(() => {
    listFunctions().then(r => {
      if (r.data) functions = Array.isArray(r.data) ? r.data : (r.data.data || [])
      loading = false
    }).catch(() => { loading = false })
  })
</script>

<div>
  <h2 style="font-size: 1.5rem; margin-bottom: 2rem;">Edge Functions</h2>

  {#if loading}
    <p style="color: var(--text-secondary);">Loading functions...</p>
  {:else if functions.length === 0}
    <div style="background: var(--surface); padding: 2rem; border-radius: 0.75rem; border: 1px solid var(--border); text-align: center;">
      <p style="color: var(--text-secondary);">No edge functions deployed.</p>
      <p style="color: var(--text-secondary); font-size: 0.875rem;">Create .ts files in your functions directory to get started.</p>
    </div>
  {:else}
    <div style="background: var(--surface); border-radius: 0.75rem; border: 1px solid var(--border); overflow: hidden;">
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="border-bottom: 1px solid var(--border);">
            <th style="text-align: left; padding: 0.75rem 1rem; font-size: 0.75rem; text-transform: uppercase; color: var(--text-secondary);">Name</th>
            <th style="text-align: left; padding: 0.75rem 1rem; font-size: 0.75rem; text-transform: uppercase; color: var(--text-secondary);">Size</th>
          </tr>
        </thead>
        <tbody>
          {#each functions as fn}
            <tr style="border-bottom: 1px solid var(--border);">
              <td style="padding: 0.75rem 1rem;">
                <code style="background: var(--bg); padding: 0.125rem 0.5rem; border-radius: 0.25rem;">{fn.name}</code>
              </td>
              <td style="padding: 0.75rem 1rem;">{fn.size || 0} bytes</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
