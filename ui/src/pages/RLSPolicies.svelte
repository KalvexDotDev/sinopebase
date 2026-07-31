<script lang="ts">
  import { listTables, getServiceRoleKey } from '../lib/api'
  import Button from '../components/Button.svelte'

  let tables = $state<Array<{ schema: string; name: string; hasRLS: boolean }>>([])
  let loading = $state(true)
  let enabling = $state('')
  let msg = $state('')

  const token = $derived(getServiceRoleKey())
  function h(): Record<string, string> { return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : {} }

  async function load() {
    const r = await listTables()
    if (r.data && Array.isArray(r.data)) tables = r.data
    loading = false
  }

  async function enableRLS(table: string) {
    enabling = table; msg = ''
    const res = await fetch(`${window.location.origin}/api/admin/rls/enable`, {
      method: 'POST', headers: h(), body: JSON.stringify({ table }),
    })
    const j = await res.json().catch(() => ({}))
    if (res.ok) { msg = `RLS enabled on ${table}.`; load() }
    else { msg = `Failed: ${j.message || res.status}` }
    enabling = ''
  }

  $effect(() => { load() })

  const rlsOn = $derived(tables.filter((t) => t.hasRLS))
  const rlsOff = $derived(tables.filter((t) => !t.hasRLS))
</script>

<div>
  <h2 style="margin-bottom: var(--space-lg);">RLS Policies</h2>

  <div class="card mb-lg">
    <p style="color: var(--text-secondary); font-size: 14px; margin-bottom: var(--space-md);">
      Row-Level Security controls which rows each role can access. Enable RLS on a table, then create policies via migration files.
    </p>
    <div style="display: flex; gap: var(--space-md);">
      <span class="chip" style="font-size: 13px; padding: 6px 16px;">{rlsOn.length} tables with RLS</span>
      <span class="chip chip-muted" style="font-size: 13px; padding: 6px 16px;">{rlsOff.length} without RLS</span>
    </div>
  </div>

  {#if msg}<div class="toast toast-success" style="margin-bottom: var(--space-md);">{msg}</div>{/if}

  {#if loading}
    <div class="card" style="padding: var(--space-lg);">{#each Array(5) as _}<div class="skeleton" style="height: 32px; margin-bottom: 8px;"></div>{/each}</div>
  {:else}
    <div class="table-wrap">
      <table>
        <thead><tr><th>Table</th><th>RLS</th><th>Action</th></tr></thead>
        <tbody>
          {#each tables as t (t.name)}
            <tr>
              <td><code>{t.schema}.{t.name}</code></td>
              <td>{#if t.hasRLS}<span class="chip">Enabled</span>{:else}<span class="chip chip-muted">Disabled</span>{/if}</td>
              <td>
                {#if t.hasRLS}
                  <span style="font-size: 12px; color: var(--text-muted);">Create policies in migration</span>
                {:else}
                  <Button variant="ghost" size="sm"
                    disabled={enabling === t.name}
                    onclick={() => enableRLS(t.name)}>
                    {enabling === t.name ? 'Enabling…' : 'Enable RLS'}
                  </Button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
