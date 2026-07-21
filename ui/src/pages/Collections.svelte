<script lang="ts">
  let tables = $state<string[]>([])
  let selectedTable = $state('')
  let records = $state<any[]>([])
  let loading = $state(false)
  let showCreate = $state(false)
  let newRecord = $state<Record<string, string>>({})
  let error = $state('')
  let token = $state('')
  let cols = $state<string[]>([])

  const baseUrl = window.location.origin

  function getToken() { return localStorage.getItem('sb-access-token') || '' }
  function authHeaders() { const t = getToken(); return t ? { Authorization: 'Bearer ' + t } : {} }

  async function loadTables() {
    token = getToken()
    if (!token) { error = 'Sign in to browse data'; return }
    // Try known tables
    const known = ['private_items', 'user', 'session']
    const found: string[] = []
    for (const t of known) {
      try {
        const r = await fetch(baseUrl + '/rest/v1/' + t + '?limit=1', { headers: authHeaders() })
        if (r.ok) found.push(t)
      } catch {}
    }
    tables = found
    error = ''
  }

  async function loadRecords(table: string) {
    selectedTable = table
    loading = true
    error = ''
    try {
      const res = await fetch(baseUrl + '/rest/v1/' + table + '?limit=50', { headers: authHeaders() })
      if (!res.ok) { error = res.status + ' ' + res.statusText; records = []; loading = false; return }
      const data = await res.json()
      records = data
      cols = data.length ? Object.keys(data[0]) : []
    } catch (e: any) { error = e.message; records = [] }
    loading = false
  }

  async function deleteRecord(id: string) {
    if (!confirm('Delete row ' + id + '?')) return
    const idCol = cols[0] || 'id'
    await fetch(baseUrl + '/rest/v1/' + selectedTable + '?' + idCol + '=eq.' + encodeURIComponent(id), {
      method: 'DELETE', headers: authHeaders()
    })
    loadRecords(selectedTable)
  }

  async function createRecord() {
    if (!selectedTable || !Object.keys(newRecord).length) return
    const res = await fetch(baseUrl + '/rest/v1/' + selectedTable, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation', ...authHeaders() },
      body: JSON.stringify(newRecord),
    })
    if (res.ok) { showCreate = false; newRecord = {}; loadRecords(selectedTable) }
    else error = 'Create failed: ' + res.status
  }

  $effect(() => { loadTables() })
</script>

<div>
  <h2 style="font-size:1.5rem;margin-bottom:1rem;">Database</h2>
  {#if error}<div style="background:#fef2f2;color:#dc3545;padding:0.75rem;border-radius:0.5rem;margin-bottom:1rem;">{error}</div>{/if}

  <div style="display:flex;gap:0.5rem;margin-bottom:1.5rem;flex-wrap:wrap;">
    {#each tables as t}
      <button onclick={() => { selectedTable = t; loadRecords(t); showCreate = false }}
        style="padding:0.5rem 1rem;border-radius:0.5rem;border:1px solid var(--border);
        background:{selectedTable === t ? 'var(--primary)' : 'var(--surface)'};
        color:{selectedTable === t ? '#fff' : 'var(--text)'};cursor:pointer;">
        {t}
      </button>
    {/each}
    {#if !token}
      <span style="color:var(--text-secondary);padding:0.5rem;">Sign in first</span>
    {/if}
  </div>

  {#if selectedTable}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
      <h3 style="margin:0;">{selectedTable} <span style="color:var(--text-secondary);font-weight:400;font-size:0.875rem;">{records.length} rows</span></h3>
      <button onclick={() => { showCreate = !showCreate; newRecord = {} }}
        style="padding:0.5rem 1rem;background:var(--primary);color:#fff;border:none;border-radius:0.5rem;cursor:pointer;">
        {showCreate ? 'Cancel' : '+ New'}
      </button>
    </div>

    {#if showCreate}
      <div style="background:var(--surface);padding:1.5rem;border-radius:0.75rem;border:1px solid var(--border);margin-bottom:1rem;">
        <h4 style="margin-bottom:1rem;">New Record</h4>
        {#each (cols.length ? cols.filter(k => k !== 'created_at' && k !== 'updatedAt') : ['name','description']) as key}
          <label style="display:block;margin-bottom:0.25rem;font-size:0.875rem;">{key}</label>
          <input type="text" value={newRecord[key] || ''}
            oninput={(e: any) => newRecord[key] = e.target.value} placeholder={key}
            style="width:100%;padding:0.5rem;border:1px solid var(--border);border-radius:0.5rem;margin-bottom:0.75rem;background:var(--bg);color:var(--text);" />
        {/each}
        <button onclick={createRecord}
          style="padding:0.5rem 1.5rem;background:#28a745;color:#fff;border:none;border-radius:0.5rem;cursor:pointer;">Create</button>
      </div>
    {/if}

    {#if loading}
      <p style="color:var(--text-secondary);">Loading...</p>
    {:else if records.length === 0}
      <p style="color:var(--text-secondary);">No records</p>
    {:else}
      <div style="background:var(--surface);border-radius:0.75rem;border:1px solid var(--border);overflow:auto;max-height:60vh;">
        <table style="width:100%;border-collapse:collapse;font-size:0.75rem;">
          <thead>
            <tr style="border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--surface);">
              {#each cols as col}
                <th style="text-align:left;padding:0.5rem;color:var(--text-secondary);text-transform:uppercase;font-size:0.625rem;white-space:nowrap;">{col}</th>
              {/each}
              <th style="width:40px;"></th>
            </tr>
          </thead>
          <tbody>
            {#each records as row}
              <tr style="border-bottom:1px solid var(--border);">
                {#each cols as col}
                  <td style="padding:0.4rem 0.5rem;max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                    {typeof row[col] === 'object' ? JSON.stringify(row[col]).slice(0,40) : String(row[col] ?? '').slice(0,80)}
                  </td>
                {/each}
                <td>
                  <button onclick={() => deleteRecord(row[cols[0]])}
                    style="padding:0.15rem 0.4rem;background:var(--danger);color:#fff;border:none;border-radius:0.25rem;cursor:pointer;font-size:0.625rem;">✕</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}
</div>
