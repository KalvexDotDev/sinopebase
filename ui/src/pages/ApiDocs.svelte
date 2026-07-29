<script lang="ts">
  import { listTables, getServiceRoleKey } from '../lib/api'

  let tables = $state<Array<{ schema: string; name: string; columns: Array<{ name: string; type: string; nullable: boolean; isPrimaryKey: boolean }> }>>([])
  let selectedTable = $state('')
  let loading = $state(true)
  let keyMode = $state<'anon' | 'service_role'>('anon')

  $effect(() => {
    listTables().then((r) => {
      if (r.data && Array.isArray(r.data)) tables = r.data
      loading = false
    }).catch(() => { loading = false })
  })

  const table = $derived(tables.find((t) => t.name === selectedTable))
  const origin = window.location.origin
  const anonKey = 'YOUR_ANON_KEY'
  const serviceKey = getServiceRoleKey() || 'YOUR_SERVICE_ROLE_KEY'
  const apiKey = $derived(keyMode === 'service_role' ? serviceKey : anonKey)
</script>

<div>
  <h2 style="margin-bottom: var(--space-lg);">API Documentation</h2>

  <div class="flex gap-md" style="align-items: flex-start;">
    <nav style="width: 220px;" class="card p-md">
      <div class="label mb-sm">Tables</div>
      {#each tables as t}
        <button onclick={() => { selectedTable = t.name }} style="display:block;width:100%;text-align:left;padding:6px 8px;border:none;
          background:{selectedTable===t.name?'var(--char)':'transparent'};color:{selectedTable===t.name?'var(--text)':'var(--text-secondary)'};
          font-family:var(--font-mono);font-size:13px;cursor:pointer;margin-bottom:2px;">
          {t.name}
        </button>
      {/each}
    </nav>

    <div class="flex-1">
      {#if !selectedTable}
        <div class="card" style="text-align:center;padding:var(--space-xl);">
          <p style="color:var(--text-secondary);">Select a table to see API examples</p>
        </div>
      {:else if table}
        <div class="card mb-md">
          <div class="flex items-center justify-between mb-md">
            <h3 style="margin:0;">{table.name}</h3>
            <div class="flex gap-sm">
              <button class={keyMode==='anon'?'btn-primary':'btn-ghost'} style="height:28px;padding:2px 12px;font-size:11px;"
                onclick={()=>{keyMode='anon'}}>Anon Key</button>
              <button class={keyMode==='service_role'?'btn-primary':'btn-ghost'} style="height:28px;padding:2px 12px;font-size:11px;"
                onclick={()=>{keyMode='service_role'}}>Service Role</button>
            </div>
          </div>
          <div class="table-wrap mb-md">
            <table>
              <thead><tr><th>Column</th><th>Type</th><th>Nullable</th><th>PK</th></tr></thead>
              <tbody>
                {#each table.columns as col}
                  <tr>
                    <td><code>{col.name}</code></td>
                    <td><span class="chip chip-muted">{col.type}</span></td>
                    <td>{col.nullable ? 'Yes' : 'No'}</td>
                    <td>{col.isPrimaryKey ? '✓' : ''}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <h3 style="margin:0 0 var(--space-md) 0;">Example Requests</h3>
          <div style="display:grid;gap:var(--space-lg);">
            <!-- SELECT -->
            <div>
              <div class="label mb-sm">Read All Rows</div>
              <pre style="background:var(--char);padding:var(--space-md);font-family:var(--font-mono);font-size:12px;color:var(--text-secondary);overflow-x:auto;border:1px solid var(--border);">
curl '{origin}/rest/v1/{table.name}?select=*&limit=10' \
  -H 'apikey: {apiKey}' \
  -H 'Authorization: Bearer {apiKey}'</pre>
            </div>
            <!-- INSERT -->
            <div>
              <div class="label mb-sm">Insert Row</div>
              <pre style="background:var(--char);padding:var(--space-md);font-family:var(--font-mono);font-size:12px;color:var(--text-secondary);overflow-x:auto;border:1px solid var(--border);">
curl '{origin}/rest/v1/{table.name}' \
  -H 'apikey: {apiKey}' \
  -H 'Authorization: Bearer {apiKey}' \
  -H 'Content-Type: application/json' \
  -H 'Prefer: return=representation' \
  -d '{{ "column": "value" }}'</pre>
            </div>
            <!-- UPDATE -->
            <div>
              <div class="label mb-sm">Update Row</div>
              <pre style="background:var(--char);padding:var(--space-md);font-family:var(--font-mono);font-size:12px;color:var(--text-secondary);overflow-x:auto;border:1px solid var(--border);">
curl '{origin}/rest/v1/{table.name}?id=eq.1' \
  -X PATCH \
  -H 'apikey: {apiKey}' \
  -H 'Authorization: Bearer {apiKey}' \
  -H 'Content-Type: application/json' \
  -d '{{ "column": "new_value" }}'</pre>
            </div>
            <!-- DELETE -->
            <div>
              <div class="label mb-sm">Delete Row</div>
              <pre style="background:var(--char);padding:var(--space-md);font-family:var(--font-mono);font-size:12px;color:var(--text-secondary);overflow-x:auto;border:1px solid var(--border);">
curl '{origin}/rest/v1/{table.name}?id=eq.1' \
  -X DELETE \
  -H 'apikey: {apiKey}' \
  -H 'Authorization: Bearer {apiKey}'</pre>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>
