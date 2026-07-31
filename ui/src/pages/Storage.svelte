<script lang="ts">
  import { getServiceRoleKey } from '../lib/api'
  import Button from '../components/Button.svelte'

  let buckets = $state<Array<{ id: string; name: string; public: boolean }>>([])
  let files = $state<Array<{ name: string; size: number; last_modified: string }>>([])
  let selectedBucket = $state('')
  let loading = $state(true)
  let error = $state('')
  let showCreate = $state(false)
  let newBucketName = $state('')
  let newBucketPublic = $state(false)

  const token = $derived(getServiceRoleKey())
  function headers(): Record<string, string> { return token ? { Authorization: `Bearer ${token}` } : {} }

  async function loadBuckets() {
    try {
      const res = await fetch(`${window.location.origin}/storage/v1/bucket`, { headers: headers() })
      if (res.ok) buckets = await res.json()
    } catch { buckets = [] }
    loading = false
  }

  async function loadFiles(bucket: string) {
    selectedBucket = bucket; loading = true
    try {
      const res = await fetch(`${window.location.origin}/storage/v1/object/list/${bucket}`, { method: 'POST', headers: headers() })
      if (res.ok) {
        const data = await res.json() as Array<{ name: string; metadata?: { size: number; lastModified: string } }>
        files = data.map((f) => ({
          name: f.name,
          size: f.metadata?.size ?? 0,
          last_modified: f.metadata?.lastModified ?? '',
        }))
      } else {
        files = [] // empty bucket or not found — show empty list
      }
    } catch { files = [] }
    loading = false
  }

  async function createBucket() {
    if (!newBucketName) { error = 'Bucket name required'; return }
    const res = await fetch(`${window.location.origin}/storage/v1/bucket`, {
      method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newBucketName, public: newBucketPublic }),
    })
    if (res.ok) { showCreate = false; selectedBucket = newBucketName; newBucketName = ''; loadBuckets() }
    else error = `Create failed: ${res.status}`
  }

  async function deleteBucket(name: string) {
    if (!confirm(`Delete bucket "${name}" and all its files?`)) return
    await fetch(`${window.location.origin}/storage/v1/bucket/${name}`, { method: 'DELETE', headers: headers() })
    if (selectedBucket === name) { selectedBucket = ''; files = [] }
    loadBuckets()
  }

  async function uploadFile(e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file || !selectedBucket) return
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch(`${window.location.origin}/storage/v1/object/${selectedBucket}/${file.name}`, {
      method: 'POST', headers: headers(), body: formData,
    })
    if (res.ok) loadFiles(selectedBucket)
    else error = `Upload failed: ${res.status}`
  }

  async function downloadFile(name: string) {
    if (!selectedBucket) return
    const res = await fetch(`${window.location.origin}/storage/v1/object/${selectedBucket}/${name}`, { headers: headers() })
    if (res.ok) {
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = name; a.click()
      URL.revokeObjectURL(url)
    } else { error = `Download failed: ${res.status}` }
  }

  async function deleteFile(name: string) {
    if (!selectedBucket) return
    await fetch(`${window.location.origin}/storage/v1/object/${selectedBucket}`, {
      method: 'DELETE',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: [name] }),
    })
    loadFiles(selectedBucket)
  }

  $effect(() => { loadBuckets() })
</script>

<div>
  <div class="flex items-center justify-between mb-lg">
    <h2 style="margin: 0;">Storage</h2>
    <Button variant="primary" size="sm"
      onclick={() => { showCreate = !showCreate; newBucketName = ''; newBucketPublic = false }}>
      + New Bucket
    </Button>
  </div>

  {#if error}<div class="toast toast-error" style="margin-bottom: var(--space-md);">{error}</div>{/if}

  {#if showCreate}
    <div class="card mb-md">
      <div class="label mb-sm">Create Bucket</div>
      <div class="flex gap-sm items-center">
        <input class="input input-sm" style="flex: 1;" placeholder="bucket-name" bind:value={newBucketName} />
        <label style="font-size: 13px; color: var(--text-secondary); display: flex; align-items: center; gap: 4px;">
          <input type="checkbox" bind:checked={newBucketPublic} /> Public
        </label>
        <Button variant="primary" size="sm" onclick={createBucket}>Create</Button>
        <Button variant="ghost" size="sm" onclick={() => { showCreate = false }}>Cancel</Button>
      </div>
    </div>
  {/if}

  <div class="flex gap-md" style="align-items: flex-start;">
    <nav style="width: 200px;" class="card p-sm">
      <div class="label mb-sm">Buckets</div>
      {#each buckets as b (b.name)}
        <button
          onclick={() => loadFiles(b.name)}
          style="display: block; width: 100%; text-align: left; padding: 6px 8px; border: none;
            background: {selectedBucket === b.name ? 'var(--char)' : 'transparent'};
            color: {selectedBucket === b.name ? 'var(--text)' : 'var(--text-secondary)'};
            font-family: var(--font-mono); font-size: 13px; cursor: pointer; margin-bottom: 2px;"
        >
          {b.name}
          {#if b.public}<span class="chip" style="margin-left: 4px; font-size: 9px; padding: 1px 6px;">public</span>{/if}
        </button>
      {/each}
    </nav>

    <div class="flex-1">
      {#if !selectedBucket}
        <div class="card" style="text-align: center; padding: var(--space-xl);">
          <p style="color: var(--text-secondary);">Select a bucket</p>
        </div>
      {:else}
        <div class="flex items-center justify-between mb-sm">
          <span style="font-family: var(--font-mono); font-size: 14px;">{selectedBucket}/</span>
          <label class="btn-ghost" style="height: 32px; padding: 4px 16px; font-size: 13px; cursor: pointer;">
            Upload File
            <input type="file" style="display: none;" onchange={uploadFile} />
          </label>
        </div>
        {#if loading}
          <div class="card" style="padding: var(--space-lg);">
            {#each Array(3) as _}<div class="skeleton" style="height: 28px; margin-bottom: 6px;"></div>{/each}
          </div>
        {:else if files.length === 0}
          <div class="card" style="text-align: center; padding: var(--space-xl);">
            <p style="color: var(--text-secondary);">Bucket is empty</p>
          </div>
        {:else}
          <div class="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Size</th><th>Modified</th><th></th></tr></thead>
              <tbody>
                {#each files as f (f.name)}
                  <tr>
                    <td><code>{f.name}</code></td>
                    <td>{f.size > 1024 ? `${(f.size / 1024).toFixed(1)} KB` : `${f.size} B`}</td>
                    <td style="color: var(--text-muted);">{f.last_modified ? new Date(f.last_modified).toLocaleString() : '—'}</td>
                    <td>
                      <Button variant="icon" size="sm" onclick={() => downloadFile(f.name)} title="Download">↓</Button>
                      <Button variant="icon" size="sm" onclick={() => deleteFile(f.name)} title="Delete">✕</Button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      {/if}
    </div>
  </div>
</div>
