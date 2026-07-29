<script lang="ts">
  import { listTables } from '../lib/api'

  let tables = $state<Array<{ schema: string; name: string; hasRLS: boolean }>>([])
  let loading = $state(true)

  $effect(() => {
    listTables().then((r) => {
      if (r.data && Array.isArray(r.data)) tables = r.data
      loading = false
    }).catch(() => { loading = false })
  })

  const rlsTables = $derived(tables.filter((t) => t.hasRLS))
  const nonRlsTables = $derived(tables.filter((t) => !t.hasRLS))
</script>

<div>
  <h2 style="margin-bottom: var(--space-lg);">RLS Policies</h2>

  <div class="card mb-lg">
    <p style="color: var(--text-secondary); font-size: 14px; margin-bottom: var(--space-md);">
      Row-Level Security policies control which rows users can access. Policies are managed via
      migration files — edit the migration and re-deploy to change them.
    </p>
    <div style="display: flex; gap: var(--space-md);">
      <div>
        <span class="chip" style="font-size: 13px; padding: 6px 16px;">{rlsTables.length} tables with RLS</span>
      </div>
      <div>
        <span class="chip chip-muted" style="font-size: 13px; padding: 6px 16px;">{nonRlsTables.length} without RLS</span>
      </div>
    </div>
  </div>

  {#if loading}
    <div class="card" style="padding: var(--space-lg);">
      {#each Array(5) as _}<div class="skeleton" style="height: 32px; margin-bottom: 8px;"></div>{/each}
    </div>
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Table</th>
            <th>RLS Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {#each tables as t}
            <tr>
              <td><code>{t.schema}.{t.name}</code></td>
              <td>
                {#if t.hasRLS}
                  <span class="chip">Enabled</span>
                {:else}
                  <span class="chip chip-muted">Disabled</span>
                {/if}
              </td>
              <td>
                <span style="font-size: 12px; color: var(--text-muted);">
                  {t.hasRLS ? 'See migrations/' : 'CREATE POLICY in migration'}
                </span>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
