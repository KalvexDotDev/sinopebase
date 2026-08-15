<script lang="ts">
  import { listTables } from '../lib/api'
  import { getServiceRoleKey } from '../lib/api'
  import Modal from '../components/Modal.svelte'
  import Button from '../components/Button.svelte'

  let tables = $state<Array<{ schema: string; name: string; columns: Array<{ name: string; type: string; nullable: boolean; isPrimaryKey: boolean }>; hasRLS: boolean }>>([])
  let selectedTable = $state('')
  let columns = $state<Array<{ name: string; type: string; nullable: boolean; isPrimaryKey: boolean }>>([])
  let rows = $state<Array<Record<string, unknown>>>([])
  let loading = $state(false)
  let error = $state('')
  let totalCount = $state(0)
  let page = $state(1)
  let perPage = $state(50)
  let sortCol = $state('')
  let sortDir = $state<'asc' | 'desc'>('asc')
  let tableSearch = $state('')
  let showAdd = $state(false)
  let addForm = $state<Record<string, string>>({})
  let addSubmitting = $state(false)
  let addError = $state('')
  let deleteId = $state('')
  let deleteLabel = $state('')
  let editCell = $state<{ row: number; col: string; val: string } | null>(null)
  let showDropTable = $state(false)
  let dropTableName = $state('')
  let dropTableConfirm = $state('')

  const token = $derived(getServiceRoleKey())
  function h(): Record<string, string> { return token ? { Authorization: `Bearer ${token}` } : {} }
  const origin = window.location.origin
  const pkCol = $derived(columns.find((c) => c.isPrimaryKey)?.name ?? columns[0]?.name ?? 'id')
  const totalPages = $derived(Math.max(1, Math.ceil(totalCount / perPage)))
  const filteredTables = $derived(tables.filter((t) => t.name.toLowerCase().includes(tableSearch.toLowerCase())))

  async function loadTables() {
    const r = await listTables()
    if (r.data && Array.isArray(r.data)) tables = r.data
  }

  async function loadRows() {
    if (!selectedTable) return
    loading = true; error = ''
    const offset = (page - 1) * perPage
    let qs = `select=*&limit=${perPage}&offset=${offset}`
    if (sortCol) qs += `&order=${sortCol}.${sortDir}`
    try {
      const [dr, cr] = await Promise.all([
        fetch(`${origin}/rest/v1/${selectedTable}?${qs}`, { headers: { ...h(), Accept: 'application/json', Prefer: 'count=exact' } }),
        fetch(`${origin}/rest/v1/${selectedTable}?select=count`, { headers: h() }),
      ])
      if (!dr.ok) { error = `${dr.status} ${dr.statusText}`; rows = []; loading = false; return }
      const data = await dr.json()
      rows = Array.isArray(data) ? data : []
      if (rows.length > 0) {
        const existing = tables.find((t) => t.name === selectedTable)
        columns = existing?.columns ?? (Object.keys(rows[0] as object).map((k) => ({ name: k, type: 'text', nullable: true, isPrimaryKey: k === 'id' })))
      }
      const range = dr.headers.get('content-range')
      totalCount = range ? parseInt(range.split('/').pop() ?? '0', 10) || rows.length : rows.length
      if (cr.ok) { const c = await cr.json() as Array<{ count: number }>; totalCount = c?.[0]?.count ?? totalCount }
    } catch (e: any) { error = e.message; rows = [] }
    loading = false
  }

  $effect(() => { loadTables() })
  $effect(() => { if (selectedTable) { page = 1; loadRows() } })
  $effect(() => { if (selectedTable && page) loadRows() })

  async function doDropTable() {
    if (dropTableConfirm !== dropTableName) return
    try {
      await fetch(`${origin}/api/admin/tables/${dropTableName}`, { method: 'DELETE', headers: h() })
      if (selectedTable === dropTableName) selectedTable = ''
      showDropTable = false; dropTableConfirm = ''
      loadTables()
    } catch (e: any) { error = e.message }
  }

  // ── Create table wizard ──
  let showCreateTable = $state(false)
  let newTableName = $state('')
  let newColumns = $state<Array<{ name: string; type: string; nullable: boolean; pk: boolean }>>([{ name: '', type: 'text', nullable: true, pk: false }])
  let createSubmitting = $state(false)
  let createError = $state('')
  let createOk = $state('')

  function openCreateTable() { showCreateTable = true; newTableName = ''; newColumns = [{ name: '', type: 'text', nullable: true, pk: false }]; createError = ''; createOk = '' }

  function addColumn() { newColumns = [...newColumns, { name: '', type: 'text', nullable: true, pk: false }] }
  function removeColumn(i: number) { if (newColumns.length > 1) newColumns = newColumns.filter((_, j) => j !== i) }

  async function doCreateTable() {
    if (!newTableName) { createError = 'Table name required'; return }
    createSubmitting = true; createError = ''; createOk = ''
    const cols = newColumns.filter((c) => c.name)
    if (cols.length === 0) { createError = 'At least one named column required'; createSubmitting = false; return }
    try {
      const res = await fetch(`${origin}/api/admin/tables`, {
        method: 'POST', headers: { ...h(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTableName, columns: cols.map((c) => ({ name: c.name, type: c.type, nullable: c.nullable, primary: c.pk })) }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok) { createOk = `Table "${newTableName}" created.`; loadTables(); setTimeout(() => { showCreateTable = false; createOk = '' }, 1500) }
      else { createError = j.message || `Error ${res.status}` }
    } catch (e: any) { createError = e.message }
    createSubmitting = false
  }

  const PG_TYPES = ['text', 'varchar', 'integer', 'bigint', 'real', 'double precision', 'boolean', 'timestamp with time zone', 'date', 'jsonb', 'uuid']

  function openAdd() { showAdd = true; addForm = {}; addError = '' }
  function closeAdd() { showAdd = false; addForm = {} }

  async function doAdd() {
    addSubmitting = true; addError = ''
    const body: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(addForm)) {
      if (v === '') continue
      const col = columns.find((c) => c.name === k)
      body[k] = col ? convertType(v, col.type) : v
    }
    try {
      const res = await fetch(`${origin}/rest/v1/${selectedTable}`, {
        method: 'POST', headers: { ...h(), 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(body),
      })
      if (res.ok) { closeAdd(); loadRows() }
      else { const j = await res.json().catch(() => ({})); addError = j.message || `Error ${res.status}` }
    } catch (e: any) { addError = e.message }
    addSubmitting = false
  }

  async function doDelete() {
    await fetch(`${origin}/rest/v1/${selectedTable}?${pkCol}=eq.${encodeURIComponent(deleteId)}`, { method: 'DELETE', headers: h() })
    deleteId = ''; deleteLabel = ''; loadRows()
  }

  async function doEdit() {
    if (!editCell) return
    const colType = columns.find((c) => c.name === editCell.col)?.type ?? 'text'
    const val = convertType(editCell.val, colType)
    const pkVal = rows[editCell.row]![pkCol]
    const res = await fetch(`${origin}/rest/v1/${selectedTable}?${pkCol}=eq.${encodeURIComponent(String(pkVal))}`, {
      method: 'PATCH', headers: { ...h(), 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ [editCell.col]: val }),
    })
    if (res.ok) { const u = await res.json(); if (Array.isArray(u) && u[0]) rows[editCell.row] = u[0] as Record<string, unknown> }
    editCell = null
  }

  function startEdit(rowIdx: number, col: string) { editCell = { row: rowIdx, col, val: fmt(rows[rowIdx]![col]) } }

  function fmt(v: unknown): string {
    if (v === null || v === undefined) return ''
    if (typeof v === 'object') return JSON.stringify(v)
    return String(v)
  }

  function trunc(v: unknown, max = 60): string { const s = fmt(v); return s.length > max ? s.slice(0, max) + '…' : s }

  function convertType(v: string, t: string): unknown {
    if (t === 'boolean' || t === 'bool') return v === 'true'
    if (t.includes('int') || t === 'numeric' || t === 'real' || t === 'float' || t === 'double precision') { const n = Number(v); return Number.isNaN(n) ? v : n }
    if (t === 'jsonb' || t === 'json') { try { return JSON.parse(v) } catch { return v } }
    return v
  }

  function exportCSV() {
    const csv = [columns.map((c) => c.name).join(','), ...rows.map((r) => columns.map((c) => JSON.stringify(r[c.name] ?? '')).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${selectedTable}.csv`; a.click()
  }
</script>

<div class="flex gap-lg" style="align-items: flex-start; height: calc(100vh - 80px);">
  <nav style="width: 220px; flex-shrink: 0; overflow-y: auto; max-height: 100%;" class="card p-lg">
    <div class="flex items-center justify-between mb-sm">
      <span class="label">Tables</span>
      <Button variant="icon" size="sm" onclick={openCreateTable} title="Create table">+</Button>
    </div>
    <input class="input" style="margin-bottom: var(--space-md);" placeholder="Search tables…" bind:value={tableSearch} />
    {#if filteredTables.length === 0}
      <p style="color: var(--text-muted); font-size: 13px;">No tables</p>
    {:else}
      {#each filteredTables as t (t.name)}
        <div
          style="display: flex; align-items: center; justify-content: space-between; width: 100%; text-align: left; padding: 6px 10px; border: none; background: {selectedTable === t.name ? 'var(--char)' : 'transparent'}; color: {selectedTable === t.name ? 'var(--text)' : 'var(--text-secondary)'}; border-radius: var(--radius-none); cursor: pointer; font-family: var(--font-mono); font-size: 12px; margin-bottom: 1px;"
        >
          <span style="flex: 1; cursor: pointer;" onclick={() => { selectedTable = t.name; editCell = null }}>{t.name}</span>
          <span style="display: flex; align-items: center; gap: 4px;">
            <span style="color: var(--text-muted); font-size: 10px;">{t.columns.length}c</span>
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <span style="color: var(--text-muted); font-size: 9px; cursor: pointer; padding: 0 2px;"
              onclick={(e: Event) => { e.stopPropagation(); dropTableName = t.name; showDropTable = true; dropTableConfirm = '' }}
              title="Drop table">✕</span>
          </span>
        </div>
      {/each}
    {/if}
  </nav>

  <div class="flex-1" style="min-width: 0;">
    {#if !selectedTable}
      <div class="card" style="text-align: center; padding: var(--space-2xl);">
        <h3 style="margin-bottom: var(--space-sm);">Select a table</h3>
        <p style="color: var(--text-secondary); font-size: 14px;">{tables.length} tables in public schema</p>
      </div>
    {:else}
      <div class="flex items-center justify-between mb-md" style="flex-wrap: wrap; gap: var(--space-sm);">
        <div class="flex items-center gap-sm">
          <span style="font-family: var(--font-mono); font-size: 15px; font-weight: 500;">{selectedTable}</span>
          <span class="chip">{totalCount} rows</span>
          {#if columns.some((c) => c.isPrimaryKey)}
            <span class="chip chip-muted">PK: {columns.filter((c) => c.isPrimaryKey).map((c) => c.name).join(', ')}</span>
          {/if}
        </div>
        <div class="flex items-center gap-sm">
          <select bind:value={perPage} onchange={() => { page = 1 }}
            style="font-size: 12px; padding: 4px 8px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: var(--radius-none);">
            <option value={25}>25</option><option value={50}>50</option><option value={100}>100</option><option value={500}>500</option>
          </select>
          <Button variant="ghost" size="sm" onclick={openAdd}>+ Add Row</Button>
          <Button variant="ghost" size="sm" onclick={exportCSV}>Export CSV</Button>
        </div>
      </div>

      {#if error}<div class="toast toast-error" style="margin-bottom: var(--space-md);">{error}</div>{/if}

      {#if loading}
        <div class="card" style="padding: var(--space-lg);">{#each Array(8) as _}<div class="skeleton" style="height: 28px; margin-bottom: 6px;"></div>{/each}</div>
      {:else if rows.length === 0}
        <div class="card" style="text-align: center; padding: var(--space-xl);">
          <p style="color: var(--text-secondary);">No rows</p>
          <Button variant="primary" size="sm" onclick={openAdd}>Add your first row</Button>
        </div>
      {:else}
        <div style="overflow-x: auto; border: 1px solid var(--border);">
          <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <thead><tr style="border-bottom: 1px solid var(--border);">
              <th style="position: sticky; left: 0; background: var(--surface); z-index: 2; padding: 6px 8px; width: 1px; white-space: nowrap;"></th>
              {#each columns as col}
                <th onclick={() => { if (sortCol === col.name) { sortDir = sortDir === 'asc' ? 'desc' : 'asc' } else { sortCol = col.name; sortDir = 'asc' } }}
                  style="cursor: pointer; padding: 6px 10px; text-align: left; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-secondary); white-space: nowrap; border-right: 1px solid var(--border); user-select: none;">
                  {col.name} <span style="margin-left: 4px; font-size: 10px;">{sortCol === col.name ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
                  <div style="font-size: 9px; color: var(--text-muted); text-transform: none; letter-spacing: 0;">{col.type}</div>
                </th>
              {/each}
            </tr></thead>
            <tbody>
              {#each rows as row, i (String(row[pkCol] ?? i))}
                <tr style="border-bottom: 1px solid var(--border);">
                  <td style="position: sticky; left: 0; background: var(--bg); z-index: 1; padding: 2px 6px; white-space: nowrap;">
                    <Button variant="icon" size="sm" onclick={() => startEdit(i, columns[0]!.name)} title="Edit">E</Button>
                    <Button variant="icon" size="sm" onclick={() => { deleteId = String(row[pkCol] ?? ''); deleteLabel = String(row[columns.find((c) => c.isPrimaryKey)?.name ?? columns[0]!.name] ?? deleteId) }} title="Delete">X</Button>
                  </td>
                  {#each columns as col}
                    <td ondblclick={() => startEdit(i, col.name)}
                      style="padding: 4px 10px; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-right: 1px solid var(--border);"
                      title={fmt(row[col.name])}>
                      {#if editCell?.row === i && editCell?.col === col.name}
                        <input class="input input-sm" style="padding: 0; margin: 0; width: 100%;" bind:value={editCell.val}
                          onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') doEdit(); if (e.key === 'Escape') { editCell = null } }}
                          onblur={doEdit} />
                      {:else}
                        {trunc(row[col.name])}
                      {/if}
                    </td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <div class="flex items-center justify-between" style="margin-top: var(--space-md);">
          <span style="font-size: 13px; color: var(--text-secondary);">{(page - 1) * perPage + 1}–{Math.min(page * perPage, totalCount)} of {totalCount}</span>
          <div class="flex items-center gap-sm">
            <Button variant="icon" size="sm" disabled={page <= 1} onclick={() => { page-- }}>←</Button>
            <span style="font-size: 13px; font-family: var(--font-mono);">{page}/{totalPages}</span>
            <Button variant="icon" size="sm" disabled={page >= totalPages} onclick={() => { page++ }}>→</Button>
          </div>
        </div>
      {/if}
    {/if}
  </div>
</div>

<Modal title="Add Row" open={showAdd} variant="slide" onclose={closeAdd}>
  <p style="font-size: 13px; color: var(--text-secondary);">{selectedTable}</p>
  <form style="flex: 1; padding: var(--space-lg); display: flex; flex-direction: column; gap: var(--space-md); overflow-y: auto;" onsubmit={(e) => { e.preventDefault(); doAdd() }}>
    {#each columns.filter((c) => !c.isPrimaryKey || !['id','uuid'].includes(c.name.toLowerCase())) as col (col.name)}
      <div>
        <label style="font-size: 13px; font-weight: 500; display: block; margin-bottom: 4px;">{col.name}
          <span style="color: var(--text-muted); font-weight: 400; margin-left: 6px; font-size: 11px;">{col.type}{col.nullable ? '' : ' *'}</span>
        </label>
        {#if col.type === 'boolean' || col.type === 'bool'}
          <select bind:value={addForm[col.name]} style="width: 100%; padding: 8px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: var(--radius-none); font-size: 13px;">
            <option value="">—</option><option value="true">true</option><option value="false">false</option>
          </select>
        {:else if col.type === 'jsonb' || col.type === 'json'}
          <textarea class="input" style="min-height: 80px; font-family: var(--font-mono); font-size: 12px;" bind:value={addForm[col.name]} placeholder="JSON value"></textarea>
        {:else}
          <input class="input" bind:value={addForm[col.name]} placeholder={col.nullable ? 'null' : 'required'} />
        {/if}
      </div>
    {/each}
    {#if addError}<div style="color: var(--danger); font-size: 13px;">{addError}</div>{/if}
    <div class="flex gap-sm" style="margin-top: var(--space-md);">
      <Button variant="primary" size="md" disabled={addSubmitting} onclick={() => doAdd()}>{addSubmitting ? 'Adding…' : 'Add Row'}</Button>
      <Button variant="ghost" size="md" onclick={closeAdd}>Cancel</Button>
    </div>
  </form>
</Modal>

<Modal title="Delete Row" open={deleteId !== ''} variant="center" onclose={() => { deleteId = ''; deleteLabel = '' }}>
  <p style="color: var(--text-secondary); font-size: 14px; margin-bottom: var(--space-lg);">Delete <code>{deleteLabel}</code> from <code>{selectedTable}</code>? This cannot be undone.</p>
  <div class="flex gap-sm" style="justify-content: flex-end;">
    <Button variant="ghost" size="sm" onclick={() => { deleteId = ''; deleteLabel = '' }}>Cancel</Button>
    <Button variant="danger" size="sm" onclick={doDelete}>Delete</Button>
  </div>
</Modal>

<Modal title="Create Table" open={showCreateTable} variant="slide" onclose={() => { showCreateTable = false }}>
  <form style="flex: 1; padding: var(--space-lg); display: flex; flex-direction: column; gap: var(--space-md); overflow-y: auto;"
    onsubmit={(e) => { e.preventDefault(); doCreateTable() }}>
    <div>
      <label style="font-size: 13px; font-weight: 500; display: block; margin-bottom: 4px;">Table name</label>
      <input class="input" bind:value={newTableName} placeholder="my_table" />
    </div>
    <div class="label">Columns</div>
    {#each newColumns as col, i (i)}
      <div style="display: flex; gap: var(--space-xs); align-items: flex-end;">
        <div style="flex: 1;"><input class="input input-sm" bind:value={col.name} placeholder="column_name" /></div>
        <div style="width: 140px;">
          <select bind:value={col.type} style="width: 100%; padding: 6px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: var(--radius-none); font-size: 12px;">
            {#each PG_TYPES as t}<option value={t}>{t}</option>{/each}
          </select>
        </div>
        <label style="font-size: 11px; color: var(--text-muted); display: flex; align-items: center; gap: 2px; white-space: nowrap;">
          <input type="checkbox" bind:checked={col.nullable} /> Null</label>
        <label style="font-size: 11px; color: var(--text-muted); display: flex; align-items: center; gap: 2px; white-space: nowrap;">
          <input type="checkbox" bind:checked={col.pk} /> PK</label>
        <Button variant="icon" size="sm"
          onclick={() => removeColumn(i)} disabled={newColumns.length <= 1}>✕</Button>
      </div>
    {/each}
    <Button variant="ghost" size="sm"
      onclick={addColumn}>+ Add Column</Button>
    {#if createError}<div style="color: var(--danger); font-size: 13px;">{createError}</div>{/if}
    {#if createOk}<div style="color: var(--lichen); font-size: 13px;">{createOk}</div>{/if}
    <div class="flex gap-sm" style="margin-top: var(--space-md);">
      <Button variant="primary" size="md" disabled={createSubmitting} onclick={() => doCreateTable()}>
        {createSubmitting ? 'Creating…' : 'Create Table'}
      </Button>
      <Button variant="ghost" size="md" onclick={() => { showCreateTable = false }}>Cancel</Button>
    </div>
  </form>
</Modal>

<Modal title="Drop Table" open={showDropTable} variant="center" onclose={() => { showDropTable = false; dropTableConfirm = '' }}>
  <p style="color: var(--danger); font-size: 14px; margin-bottom: var(--space-md);">
    This permanently deletes <code>{dropTableName}</code> and all its data.
  </p>
  <p style="color: var(--text-secondary); font-size: 13px; margin-bottom: var(--space-sm);">
    Type <code>{dropTableName}</code> to confirm:
  </p>
  <input class="input" style="margin-bottom: var(--space-lg);" bind:value={dropTableConfirm} placeholder={dropTableName} />
  <div class="flex gap-sm" style="justify-content: flex-end;">
    <Button variant="ghost" size="sm" onclick={() => { showDropTable = false; dropTableConfirm = '' }}>Cancel</Button>
    <Button variant="danger" size="sm"
      disabled={dropTableConfirm !== dropTableName}
      onclick={doDropTable}>Drop "{dropTableName}"</Button>
  </div>
</Modal>
