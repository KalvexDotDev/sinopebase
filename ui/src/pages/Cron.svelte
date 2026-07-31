<script lang="ts">
  import Button from '../components/Button.svelte'
  import Modal from '../components/Modal.svelte'
  import { getServiceRoleKey } from '../lib/api'

  let jobs = $state<Array<{ id: string; label: string; schedule: string; lastRun: string | null }>>([])
  let loading = $state(true)
  let showCreate = $state(false)
  let editId = $state('')
  let form = $state({ id: '', label: '', schedule: '' })
  let submitting = $state(false)
  let formError = $state('')

  const token = $derived(getServiceRoleKey())
  const origin = window.location.origin
  function h(): Record<string, string> {
    const hdrs: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) hdrs['Authorization'] = `Bearer ${token}`
    return hdrs
  }

  async function load() {
    try { const res = await fetch(`${origin}/api/crons`, { headers: h() }); if (res.ok) jobs = await res.json() } catch {}
    loading = false
  }

  async function doCreate() {
    if (!form.id) { formError = 'ID required'; return }
    submitting = true; formError = ''
    const res = await fetch(`${origin}/api/crons`, { method: 'POST', headers: h(), body: JSON.stringify(form) })
    if (res.ok) { showCreate = false; load() } else { const j = await res.json().catch(() => ({})); formError = j.message || `Error ${res.status}` }
    submitting = false
  }

  async function doSave(id: string) {
    submitting = true
    const res = await fetch(`${origin}/api/crons/${id}`, { method: 'PATCH', headers: h(), body: JSON.stringify({ label: form.label, schedule: form.schedule }) })
    if (res.ok) { editId = ''; load() } else { const j = await res.json().catch(() => ({})); formError = j.message || `Error ${res.status}` }
    submitting = false
  }

  async function doDelete(id: string) {
    if (!confirm(`Delete "${id}"?`)) return
    await fetch(`${origin}/api/crons/${id}`, { method: 'DELETE', headers: h() })
    load()
  }

  function openCreate() { showCreate = true; form = { id: '', label: '', schedule: '' }; formError = '' }
  function openEdit(j: any) { editId = j.id; form = { id: j.id, label: j.label || '', schedule: j.schedule || '' }; formError = '' }

  $effect(() => { load() })
</script>

<div>
  <div class="flex items-center justify-between mb-lg">
    <h2 style="margin: 0;">Cron Jobs</h2>
    <Button variant="primary" size="sm" onclick={openCreate}>+ New Job</Button>
  </div>

  {#if loading}
    <div class="card" style="padding: var(--space-lg);">{#each Array(3) as _}<div class="skeleton" style="height: 36px; margin-bottom: 6px;"></div>{/each}</div>
  {:else if jobs.length === 0}
    <div class="card" style="text-align: center; padding: var(--space-xl);">
      <p style="color: var(--text-secondary);">No cron jobs.</p>
      <Button variant="primary" size="sm" onclick={openCreate}>Create Cron Job</Button>
    </div>
  {:else}
    <div class="table-wrap"><table>
      <thead><tr><th>ID</th><th>Label</th><th>Schedule</th><th></th></tr></thead>
      <tbody>
        {#each jobs as job (job.id)}
          <tr>
            <td><code>{job.id}</code></td>
            <td>{job.label || '—'}</td>
            <td><code style="font-size: 12px;">{job.schedule || '—'}</code></td>
            <td>
              <Button variant="ghost" size="sm" onclick={() => openEdit(job)}>Edit</Button>
              <Button variant="icon" size="sm" onclick={() => doDelete(job.id)}>✕</Button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table></div>
  {/if}
</div>

<Modal title="Create Cron Job" open={showCreate} variant="slide" onclose={() => { showCreate = false }}>
  <form style="padding: var(--space-lg); display: flex; flex-direction: column; gap: var(--space-md);" onsubmit={(e) => { e.preventDefault(); doCreate() }}>
    <div><label class="label" style="margin-bottom: 4px;">ID</label><input class="input" bind:value={form.id} placeholder="cleanup" /></div>
    <div><label class="label" style="margin-bottom: 4px;">Label</label><input class="input" bind:value={form.label} placeholder="Cleanup temp files" /></div>
    <div><label class="label" style="margin-bottom: 4px;">Schedule (cron)</label><input class="input" bind:value={form.schedule} placeholder="0 3 * * *" /></div>
    {#if formError}<div style="color: var(--danger); font-size: 13px;">{formError}</div>{/if}
    <div class="flex gap-sm"><Button variant="primary" disabled={submitting} onclick={doCreate}>{submitting ? '…' : 'Create'}</Button><Button variant="ghost" onclick={() => { showCreate = false }}>Cancel</Button></div>
  </form>
</Modal>

<Modal title="Edit Cron Job" open={editId !== ''} variant="slide" onclose={() => { editId = '' }}>
  <form style="padding: var(--space-lg); display: flex; flex-direction: column; gap: var(--space-md);" onsubmit={(e) => { e.preventDefault(); doSave(editId) }}>
    <div><label class="label" style="margin-bottom: 4px;">Label</label><input class="input" bind:value={form.label} /></div>
    <div><label class="label" style="margin-bottom: 4px;">Schedule</label><input class="input" bind:value={form.schedule} /></div>
    {#if formError}<div style="color: var(--danger); font-size: 13px;">{formError}</div>{/if}
    <div class="flex gap-sm"><Button variant="primary" disabled={submitting} onclick={() => doSave(editId)}>{submitting ? '…' : 'Save'}</Button><Button variant="ghost" onclick={() => { editId = '' }}>Cancel</Button></div>
  </form>
</Modal>
