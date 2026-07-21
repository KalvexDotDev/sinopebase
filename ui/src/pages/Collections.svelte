<script lang="ts">
  import { listCollections } from '../lib/api'

  let collections = $state<any[]>([])
  let loading = $state(true)

  $effect(() => {
    listCollections().then(r => {
      if (r.data) {
        if (Array.isArray(r.data)) collections = r.data
        else if (r.data.data) collections = r.data.data
      }
      loading = false
    }).catch(() => { loading = false })
  })
</script>

<div>
  <h2 style="font-size: 1.5rem; margin-bottom: 2rem;">Collections</h2>

  {#if loading}
    <p style="color: var(--text-secondary);">Loading collections...</p>
  {:else if collections.length === 0}
    <div style="background: var(--surface); padding: 2rem; border-radius: 0.75rem; border: 1px solid var(--border); text-align: center;">
      <p style="color: var(--text-secondary);">No collections yet.</p>
      <p style="color: var(--text-secondary); font-size: 0.875rem;">Create collections via the API to get started.</p>
    </div>
  {:else}
    <div style="background: var(--surface); border-radius: 0.75rem; border: 1px solid var(--border); overflow: hidden;">
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="border-bottom: 1px solid var(--border);">
            <th style="text-align: left; padding: 0.75rem 1rem; font-size: 0.75rem; text-transform: uppercase; color: var(--text-secondary);">Name</th>
            <th style="text-align: left; padding: 0.75rem 1rem; font-size: 0.75rem; text-transform: uppercase; color: var(--text-secondary);">Type</th>
            <th style="text-align: left; padding: 0.75rem 1rem; font-size: 0.75rem; text-transform: uppercase; color: var(--text-secondary);">Fields</th>
          </tr>
        </thead>
        <tbody>
          {#each collections as col}
            <tr style="border-bottom: 1px solid var(--border);">
              <td style="padding: 0.75rem 1rem;">{col.name || col.id || 'Unknown'}</td>
              <td style="padding: 0.75rem 1rem;">{col.type || 'base'}</td>
              <td style="padding: 0.75rem 1rem;">{col.fields?.length || 0}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
