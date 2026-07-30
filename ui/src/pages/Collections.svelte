<script lang="ts">
  import { listTables, listRecords } from '../lib/api'
  import { getServiceRoleKey } from '../lib/api'

  // ── State ──
  let tables = $state<Array<{ schema: string; name: string; columns: Array<{ name: string; type: string; nullable: boolean; isPrimaryKey: boolean }> }>>([])
  let selectedTable = $state('')
  let columns = $state<Array<{ name: string; type: string; nullable: boolean; isPrimaryKey: boolean }>>([])
  let rows = $state<Array<Record<string, unknown>>>([])
  let loading = $state(false)
  let error = $state('')
  let totalCount = $state(0)

  // Pagination
  let page = $state(1)
  let perPage = $state(50)
  let sortCol = $state('')
  let sortDir = $state<'asc' | 'desc'>('asc')
  let filterText = $state('')

  // Inline editing
  let editingCell = $state<{ row: number; col: string } | null>(null)
  let editValue = $state('')

  // Insert row
  let showInsert = $state(false)
  let newRow = $state<Record<string, string>>({})

  // Import/Export
  let showImport = $state(false)
  let importJson = $state('')

  // Delete confirmation
  let deleteTarget = $state<Record<string, unknown> | null>(null)

  const token = $derived(getServiceRoleKey())

  // ── Derived: primary key column ──
  const pkCol = $derived(columns.find((c) => c.isPrimaryKey)?.name ?? columns[0]?.name ?? 'id')

  // ── Load tables ──
  async function loadTables() {
    const result = await listTables()
    if (result.data) {
      // If the REST endpoint returned data, parse it
      if (Array.isArray(result.data)) {
        tables = result.data
      }
    } else if (result.error) {
      error = result.error.message
    }
  }

  // ── Load records ──
  async function loadRecords() {
    if (!selectedTable) return
    loading = true; error = ''
    const params = new URLSearchParams()
    params.set('limit', String(perPage))
    params.set('offset', String((page - 1) * perPage))
    if (sortCol) params.set('order', `${sortCol}.${sortDir}`)
    if (filterText) params.set('or', `(${columns.map((c) => `${c.name}.ilike.%25${filterText}%25`).join(',')})`)

    // Also get count
    try {
      const baseUrl = window.location.origin
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
      headers['Accept'] = 'application/json'

      const [dataRes, countRes] = await Promise.all([
        fetch(`${baseUrl}/rest/v1/${selectedTable}?${params.toString()}`, {
          headers: { ...headers, Prefer: 'count=exact' },
        }),
        fetch(`${baseUrl}/rest/v1/${selectedTable}?select=count`, { headers }),
      ])

      if (!dataRes.ok) {
        error = `${dataRes.status} ${dataRes.statusText}`
        rows = []; loading = false; return
      }
      const data = await dataRes.json()
      rows = Array.isArray(data) ? data : []
      if (rows.length > 0) {
        columns = Object.keys(rows[0] as object).map((k) => ({
          name: k, type: typeof (rows[0] as Record<string, unknown>)[k] === 'number' ? 'number' : 'text',
          nullable: true, isPrimaryKey: k === 'id',
        }))
      }
      totalCount = parseInt(dataRes.headers.get('content-range')?.split('/').pop() ?? '0', 10) || rows.length

      if (countRes.ok) {
        const countData = await countRes.json() as Array<{ count: number }>
        if (countData?.[0]?.count != null) totalCount = countData[0].count
      }
    } catch (e: any) {
      error = e.message; rows = []
    }
    loading = false
  }

  // ── Effects ──
  $effect(() => { loadTables() })
  $effect(() => {
    if (selectedTable) { page = 1; loadRecords() }
  })
  $effect(() => { if (selectedTable && page) loadRecords() })

  // ── Actions ──
  function selectTable(name: string) { selectedTable = name; editingCell = null }

  function toggleSort(col: string) {
    if (sortCol === col) sortDir = sortDir === 'asc' ? 'desc' : 'asc'
    else { sortCol = col; sortDir = 'asc' }
  }

  function startEdit(rowIdx: number, col: string, value: unknown) {
    editingCell = { row: rowIdx, col }
    editValue = String(value ?? '')
  }
  function cancelEdit() { editingCell = null }

  async function saveEdit(rowIdx: number) {
    if (!editingCell || !selectedTable) return
    const row = rows[rowIdx]
    if (!row) return
    const pkVal = row[pkCol]
    const body: Record<string, unknown> = { [editingCell.col]: tryParse(editValue) }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await fetch(
      `${window.location.origin}/rest/v1/${selectedTable}?${pkCol}=eq.${encodeURIComponent(String(pkVal))}`,
      { method: 'PATCH', headers, body: JSON.stringify(body) },
    )
    if (res.ok) {
      const updated = await res.json()
      if (Array.isArray(updated) && updated[0]) rows[rowIdx] = updated[0] as Record<string, unknown>
      editingCell = null
    } else {
      error = `Save failed: ${res.status}`
    }
  }

  async function deleteRow(row: Record<string, unknown>) {
    if (!selectedTable) return
    const pkVal = row[pkCol]
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    await fetch(
      `${window.location.origin}/rest/v1/${selectedTable}?${pkCol}=eq.${encodeURIComponent(String(pkVal))}`,
      { method: 'DELETE', headers },
    )
    deleteTarget = null
    loadRecords()
  }

  async function insertRow() {
    if (!selectedTable || !Object.keys(newRow).length) return
    const body: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(newRow)) {
      if (v) body[k] = tryParse(v)
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    }
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await fetch(`${window.location.origin}/rest/v1/${selectedTable}`, {
      method: 'POST', headers, body: JSON.stringify(body),
    })
    if (res.ok) {
      showInsert = false
      newRow = {}
      loadRecords()
    } else {
      error = `Insert failed: ${res.status}`
    }
  }

  function exportCSV() {
    if (!rows.length) return
    const cols = columns.map((c) => c.name)
    const csv = [
      cols.join(','),
      ...rows.map((r) => cols.map((c) => JSON.stringify(r[c] ?? '')).join(',')),
    ].join('\n')
    downloadBlob(csv, `${selectedTable}.csv`, 'text/csv')
  }

  function exportJSON() {
    downloadBlob(JSON.stringify(rows, null, 2), `${selectedTable}.json`, 'application/json')
  }

  function importData() {
    try {
      const data = JSON.parse(importJson)
      const items = Array.isArray(data) ? data : [data]
      let count = 0
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (token) headers['Authorization'] = `Bearer ${token}`
      Promise.all(
        items.map(async (item: Record<string, unknown>) => {
          const res = await fetch(`${window.location.origin}/rest/v1/${selectedTable}`, {
            method: 'POST', headers, body: JSON.stringify(item),
          })
          if (res.ok) count++
        }),
      ).then(() => {
        showImport = false
        importJson = ''
        loadRecords()
      })
    } catch {
      error = 'Invalid JSON'
    }
  }

  function downloadBlob(content: string, filename: string, mime: string) {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }

  function tryParse(v: string): unknown {
    if (v === 'true') return true
    if (v === 'false') return false
    if (v === 'null') return null
    const n = Number(v)
    if (!Number.isNaN(n) && v.trim() !== '') return n
    return v
  }

  function formatCell(val: unknown): string {
    if (val === null || val === undefined) return '—'
    if (typeof val === 'object') return JSON.stringify(val)
    return String(val)
  }

  const totalPages = $derived(Math.max(1, Math.ceil(totalCount / perPage)))
</script>

<div>
  <!-- Header -->
  <div class="flex items-center justify-between mb-lg">
    <div>
      <h2 style="margin: 0;">Table Editor</h2>
      <p class="label" style="margin-top: 4px;">{tables.length} tables in public schema</p>
    </div>
    <div class="flex gap-sm items-center">
      {#if selectedTable}
        <button class="btn-ghost" onclick={() => { showInsert = !showInsert; newRow = {} }}>
          + New Row
        </button>
        <button class="btn-ghost" onclick={exportJSON}>Export JSON</button>
        <button class="btn-ghost" onclick={exportCSV}>Export CSV</button>
        <button class="btn-ghost" onclick={() => { showImport = !showImport; importJson = '' }}>
          Import
        </button>
      {/if}
    </div>
  </div>

  {#if error}
    <div class="toast toast-error" style="margin-bottom: var(--space-md);">{error}</div>
  {/if}

  <div class="flex gap-md" style="align-items: flex-start;">
    <!-- Table sidebar -->
    <nav style="width: 220px; flex-shrink: 0;" class="card p-sm">
      <div class="label mb-sm">Tables</div>
      {#if tables.length === 0}
        <p style="color: var(--text-muted); font-size: 13px;">No tables found</p>
      {:else}
        {#each tables as t}
          <button
            onclick={() => selectTable(t.name)}
            style="display: block; width: 100%; text-align: left; padding: 6px 8px; border: none;
              background: {selectedTable === t.name ? 'var(--char)' : 'transparent'};
              color: {selectedTable === t.name ? 'var(--text)' : 'var(--text-secondary)'};
              border-radius: var(--radius-none); cursor: pointer; font-size: 13px;
              font-family: var(--font-mono); margin-bottom: 2px;"
          >
            {t.name}
            {#if t.hasRLS}
              <span class="chip" style="margin-left: 6px; font-size: 9px; padding: 1px 6px;">RLS</span>
            {/if}
          </button>
        {/each}
      {/if}
    </nav>

    <!-- Main content -->
    <div class="flex-1" style="min-width: 0;">
      {#if !selectedTable}
        <div class="card" style="text-align: center; padding: var(--space-2xl) var(--space-lg);">
          <p style="color: var(--text-secondary); font-size: 17px; margin-bottom: var(--space-sm);">
            Select a table to browse its data
          </p>
          <p style="color: var(--text-muted); font-size: 13px;">
            Tables are discovered from the <code>public</code> schema.
          </p>
        </div>
      {:else}
        <!-- Controls bar -->
        <div class="flex items-center justify-between mb-md" style="flex-wrap: wrap; gap: var(--space-sm);">
          <div class="flex items-center gap-sm">
            <span style="font-family: var(--font-mono); font-size: 14px; font-weight: 500;">{selectedTable}</span>
            <span class="chip">{totalCount} rows</span>
          </div>
          <div class="flex items-center gap-sm">
            <input class="input input-sm" style="width: 200px;" placeholder="Filter…" bind:value={filterText}
              oninput={() => { page = 1 }} />
            <select
              style="font-family: var(--font-ui); font-size: 13px; padding: 4px 8px; background: var(--bg);
                color: var(--text); border: 1px solid var(--border); border-radius: var(--radius-none);"
              bind:value={perPage}
              onchange={() => { page = 1 }}
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={500}>500</option>
            </select>
          </div>
        </div>

        <!-- Import panel -->
        {#if showImport}
          <div class="card mb-md">
            <div class="label mb-sm">Import JSON</div>
            <textarea class="input" style="min-height: 120px; font-family: var(--font-mono); font-size: 12px;"
              placeholder="Paste JSON array of objects here" bind:value={importJson}></textarea>
            <div class="flex gap-sm" style="margin-top: var(--space-sm);">
              <button class="btn-primary" style="height: 32px; padding: 4px 16px; font-size: 13px;"
                onclick={importData}>Import</button>
              <button class="btn-ghost" style="height: 32px; padding: 4px 16px; font-size: 13px;"
                onclick={() => { showImport = false; importJson = '' }}>Cancel</button>
            </div>
          </div>
        {/if}

        <!-- Insert row form -->
        {#if showInsert}
          <div class="card mb-md">
            <div class="label mb-sm">New Row</div>
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: var(--space-sm); margin-bottom: var(--space-sm);">
              {#each columns.filter((c) => !c.isPrimaryKey || c.name !== 'id') as col}
                <div>
                  <span style="font-size: 11px; color: var(--text-secondary); display: block; margin-bottom: 2px;">
                    {col.name}
                    <span style="color: var(--text-muted);">({col.type})</span>
                  </span>
                  <input class="input input-sm" placeholder={col.nullable ? 'null' : 'required'}
                    value={newRow[col.name] ?? ''}
                    oninput={(e: Event) => { newRow[col.name] = (e.target as HTMLInputElement).value }} />
                </div>
              {/each}
            </div>
            <div class="flex gap-sm">
              <button class="btn-primary" style="height: 32px; padding: 4px 16px; font-size: 13px;"
                onclick={insertRow}>Create</button>
              <button class="btn-ghost" style="height: 32px; padding: 4px 16px; font-size: 13px;"
                onclick={() => { showInsert = false; newRow = {} }}>Cancel</button>
            </div>
          </div>
        {/if}

        <!-- Data table -->
        {#if loading}
          <div class="table-wrap">
            <div style="padding: var(--space-xl);">
              {#each Array(5) as _}
                <div class="skeleton" style="height: 32px; margin-bottom: 8px;"></div>
              {/each}
            </div>
          </div>
        {:else if rows.length === 0}
          <div class="card" style="text-align: center; padding: var(--space-xl);">
            <p style="color: var(--text-secondary);">No rows found</p>
            {#if filterText}
              <p style="color: var(--text-muted); font-size: 13px; margin-top: 4px;">
                Try adjusting your filter.
              </p>
            {/if}
          </div>
        {:else}
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  {#each columns as col}
                    <th class="sortable" onclick={() => toggleSort(col.name)}>
                      {col.name}
                      {#if sortCol === col.name}
                        <span style="margin-left: 2px;">{sortDir === 'asc' ? '↑' : '↓'}</span>
                      {/if}
                    </th>
                  {/each}
                  <th style="width: 60px;"></th>
                </tr>
              </thead>
              <tbody>
                {#each rows as row, i}
                  <tr>
                    {#each columns as col}
                      <td
                        ondblclick={() => startEdit(i, col.name, row[col.name])}
                        title={String(row[col.name] ?? '')}
                        style="cursor: pointer;"
                      >
                        {#if editingCell?.row === i && editingCell?.col === col.name}
                          <input
                            class="input input-sm"
                            style="width: 100%; padding: 0; margin: 0;"
                            bind:value={editValue}
                            onkeydown={(e: KeyboardEvent) => {
                              if (e.key === 'Enter') saveEdit(i)
                              if (e.key === 'Escape') cancelEdit()
                            }}
                            onblur={() => saveEdit(i)}
                          />
                        {:else}
                          {formatCell(row[col.name])}
                        {/if}
                      </td>
                    {/each}
                    <td>
                      <button class="btn-icon" title="Delete row"
                        onclick={() => { deleteTarget = row }}>
                        ✕
                      </button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>

          <!-- Pagination -->
          <div class="flex items-center justify-between" style="margin-top: var(--space-md);">
            <span style="font-size: 13px; color: var(--text-secondary);">
              Showing {((page - 1) * perPage) + 1}–{Math.min(page * perPage, totalCount)} of {totalCount}
            </span>
            <div class="flex items-center gap-sm">
              <button class="btn-icon" disabled={page <= 1} onclick={() => { page-- }}>
                ←
              </button>
              <span style="font-size: 13px; font-family: var(--font-mono); color: var(--text-secondary);">
                {page} / {totalPages}
              </span>
              <button class="btn-icon" disabled={page >= totalPages} onclick={() => { page++ }}>
                →
              </button>
            </div>
          </div>
        {/if}
      {/if}
    </div>
  </div>

  <!-- Delete confirmation modal -->
  {#if deleteTarget}
    <div style="position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100;">
      <div class="card" style="max-width: 400px; width: 90%;">
        <h3 style="margin-bottom: var(--space-md);">Delete Row</h3>
        <p style="color: var(--text-secondary); margin-bottom: var(--space-lg); font-size: 14px;">
          Are you sure you want to delete this row? This action cannot be undone.
        </p>
        <div class="flex gap-sm" style="justify-content: flex-end;">
          <button class="btn-ghost" onclick={() => { deleteTarget = null }}>Cancel</button>
          <button class="btn-danger" onclick={() => deleteRow(deleteTarget)}>Delete</button>
        </div>
      </div>
    </div>
  {/if}
</div>
