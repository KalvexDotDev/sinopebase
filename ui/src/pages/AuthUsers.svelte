<script lang="ts">
  import { getServiceRoleKey } from '../lib/api'
  import Button from '../components/Button.svelte'

  let users = $state<Array<Record<string, unknown>>>([])
  let loading = $state(true)
  let error = $state('')
  let search = $state('')
  let showCreate = $state(false)
  let newEmail = $state('')
  let newPassword = $state('')

  const token = $derived(getServiceRoleKey())

  async function loadUsers() {
    loading = true; error = ''
    try {
      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`
      const res = await fetch(`${window.location.origin}/rest/v1/user?select=*&order=createdAt.desc&limit=200`, { headers })
      if (res.ok) users = await res.json()
      else error = `Failed to load users: ${res.status}`
    } catch (e: any) { error = e.message }
    loading = false
  }

  async function createUser() {
    if (!newEmail || !newPassword) { error = 'Email and password required'; return }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await fetch(`${window.location.origin}/auth/v1/signup`, {
      method: 'POST', headers,
      body: JSON.stringify({ email: newEmail, password: newPassword }),
    })
    if (res.ok) { showCreate = false; newEmail = ''; newPassword = ''; loadUsers() }
    else { const j = await res.json().catch(() => ({})); error = `Create failed: ${res.status} — ${j.message || ''}` }
  }

  async function deleteUser(id: string, email: string) {
    if (!confirm(`Delete user "${email}"?`)) return
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await fetch(`${window.location.origin}/rest/v1/user?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers })
    if (!res.ok) { error = `Delete failed: ${res.status}`; return }
    loadUsers()
  }

  $effect(() => { loadUsers() })

  const filtered = $derived(users.filter((u) => {
    if (!search) return true
    const q = search.toLowerCase()
    const email = String(u.email ?? '').toLowerCase()
    return email.includes(q)
  }))
</script>

<div>
  <div class="flex items-center justify-between mb-lg">
    <div>
      <h2 style="margin: 0;">Auth Users</h2>
      <p class="label" style="margin-top: 4px;">{users.length} users</p>
    </div>
    <div class="flex gap-sm">
      <input class="input input-sm" style="width: 200px;" placeholder="Search by email…" bind:value={search} />
      <Button variant="primary" size="sm" onclick={() => { showCreate = !showCreate; newEmail = ''; newPassword = '' }}>
        + New User
      </Button>
    </div>
  </div>

  {#if error}<div class="toast toast-error" style="margin-bottom: var(--space-md);">{error}</div>{/if}

  {#if showCreate}
    <div class="card mb-md">
      <div class="label mb-sm">Create User</div>
      <div style="display: flex; gap: var(--space-sm); align-items: flex-end;">
        <div style="flex: 1;">
          <span style="font-size: 11px; color: var(--text-secondary); display: block; margin-bottom: 2px;">Email</span>
          <input class="input input-sm" bind:value={newEmail} placeholder="user@example.com" />
        </div>
        <div style="flex: 1;">
          <span style="font-size: 11px; color: var(--text-secondary); display: block; margin-bottom: 2px;">Password</span>
          <input class="input input-sm" type="password" bind:value={newPassword} placeholder="min 8 chars" />
        </div>
        <Button variant="primary" size="sm" onclick={createUser}>Create</Button>
        <Button variant="ghost" size="sm" onclick={() => { showCreate = false }}>Cancel</Button>
      </div>
    </div>
  {/if}

  {#if loading}
    <div class="card" style="padding: var(--space-xl);">
      {#each Array(5) as _}<div class="skeleton" style="height: 36px; margin-bottom: 8px;"></div>{/each}
    </div>
  {:else if filtered.length === 0}
    <div class="card" style="text-align: center; padding: var(--space-xl);">
      <p style="color: var(--text-secondary);">No users found</p>
    </div>
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Email</th>
            <th>Role</th>
            <th>Verified</th>
            <th>Created</th>
            <th style="width: 60px;"></th>
          </tr>
        </thead>
        <tbody>
          {#each filtered as user}
            <tr>
              <td><code>{user.email}</code></td>
              <td><span class="chip">{user.role || 'user'}</span></td>
              <td>{user.emailVerified ? '✓' : '—'}</td>
              <td style="font-size: 12px; color: var(--text-muted);">{user.createdAt ? new Date(user.createdAt as string).toLocaleDateString() : '—'}</td>
              <td><Button variant="icon" size="sm" onclick={() => deleteUser(user.id as string, user.email as string)}>✕</Button></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
