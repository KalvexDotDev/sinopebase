<script lang="ts">
  import { listBackups, createBackup, restoreBackup } from '../lib/api'
  import Button from '../components/Button.svelte'

  let backups = $state<Array<{ name: string; size: number; modified: string }>>([])
  let loading = $state(true)
  let error = $state('')
  let success = $state('')
  let showCreate = $state(false)
  let backupName = $state('')
  let restoring = $state('')

  async function load() {
    loading = true; error = ''
    const result = await listBackups()
    if (result.data && Array.isArray(result.data)) backups = result.data
    else if (result.error) error = result.error.message
    loading = false
  }

  async function doCreate() {
    if (!backupName) { error = 'Backup name required'; return }
    const result = await createBackup(backupName)
    if (result.error) error = result.error.message
    else { success = `Backup "${backupName}" created`; showCreate = false; backupName = ''; load() }
  }

  async function doRestore(name: string) {
    restoring = name
    const result = await restoreBackup(name)
    if (result.error) error = result.error.message
    else success = `Restored from "${name}"`
    restoring = ''
    load()
  }

  function formatSize(bytes: number): string {
    if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    if (bytes > 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${bytes} B`
  }

  $effect(() => { load() })
</script>

<div>
  <div class="flex items-center justify-between mb-lg">
    <h2 style="margin: 0;">Backups</h2>
    <Button variant="primary" size="sm"
      onclick={() => { showCreate = !showCreate; backupName = '' }}>
      + New Backup
    </Button>
  </div>

  {#if error}<div class="toast toast-error" style="margin-bottom: var(--space-md);">{error}</div>{/if}
  {#if success}<div class="toast toast-success" style="margin-bottom: var(--space-md);">{success}</div>{/if}

  {#if showCreate}
    <div class="card mb-md">
      <div class="label mb-sm">Create Backup</div>
      <div class="flex gap-sm items-center">
        <input class="input input-sm" style="flex: 1;" placeholder="backup-name" bind:value={backupName} />
        <Button variant="primary" size="sm" onclick={doCreate}>Create</Button>
        <Button variant="ghost" size="sm" onclick={() => { showCreate = false }}>Cancel</Button>
      </div>
    </div>
  {/if}

  {#if loading}
    <div class="card" style="padding: var(--space-lg);">
      {#each Array(5) as _}<div class="skeleton" style="height: 32px; margin-bottom: 8px;"></div>{/each}
    </div>
  {:else if backups.length === 0}
    <div class="card" style="text-align: center; padding: var(--space-xl);">
      <p style="color: var(--text-secondary);">No backups yet</p>
    </div>
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Name</th><th>Size</th><th>Modified</th><th></th></tr>
        </thead>
        <tbody>
          {#each backups as b}
            <tr>
              <td><code>{b.name}</code></td>
              <td>{formatSize(b.size)}</td>
              <td style="color: var(--text-muted);">{new Date(b.modified).toLocaleString()}</td>
              <td>
                <Button variant="ghost" size="sm"
                  disabled={restoring === b.name}
                  onclick={() => { if (confirm(`Restore from "${b.name}"? This will overwrite current data.`)) doRestore(b.name) }}>
                  {restoring === b.name ? 'Restoring…' : 'Restore'}
                </Button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
