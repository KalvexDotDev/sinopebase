<script lang="ts">
  import { getSettings, updateSettings, getServiceRoleKey } from '../lib/api'

  let settings = $state<Record<string, unknown>>({})
  let loading = $state(true)
  let saving = $state(false)
  let error = $state('')
  let success = $state('')

  let appName = $state('')
  let serverPort = $state('')
  let dataDir = $state('')
  let allowSignups = $state(false)

  async function load() {
    loading = true
    const result = await getSettings()
    if (result.data) {
      settings = result.data as Record<string, unknown>
      appName = String(settings.appName ?? 'Sinopebase')
      serverPort = String(settings.port ?? '8090')
      dataDir = String(settings.dataDir ?? './pb_data')
      allowSignups = Boolean(settings.allowSignups ?? true)
    }
    loading = false
  }

  async function save() {
    saving = true; error = ''; success = ''
    const result = await updateSettings({ appName, port: parseInt(serverPort, 10), dataDir, allowSignups })
    if (result.error) error = result.error.message
    else success = 'Settings saved successfully'
    saving = false
  }

  $effect(() => { load() })
</script>

<div>
  <div class="flex items-center justify-between mb-lg">
    <h2 style="margin: 0;">Settings</h2>
    <button class="btn-primary" style="height: 32px; padding: 4px 16px; font-size: 13px;" disabled={saving}
      onclick={save}>
      {saving ? 'Saving…' : 'Save Changes'}
    </button>
  </div>

  {#if error}<div class="toast toast-error" style="margin-bottom: var(--space-md);">{error}</div>{/if}
  {#if success}<div class="toast toast-success" style="margin-bottom: var(--space-md);">{success}</div>{/if}

  {#if loading}
    <div class="card" style="padding: var(--space-lg);">
      {#each Array(5) as _}<div class="skeleton" style="height: 40px; margin-bottom: 12px;"></div>{/each}
    </div>
  {:else}
    <div class="card" style="max-width: 600px;">
      <!-- General -->
      <div class="label" style="margin-bottom: var(--space-md);">General</div>
      <div style="display: grid; gap: var(--space-md);">
        <div>
          <span style="font-size: 13px; color: var(--text-secondary); display: block; margin-bottom: 4px;">App Name</span>
          <input class="input" bind:value={appName} />
        </div>
        <div>
          <span style="font-size: 13px; color: var(--text-secondary); display: block; margin-bottom: 4px;">Server Port</span>
          <input class="input" type="number" bind:value={serverPort} />
        </div>
        <div>
          <span style="font-size: 13px; color: var(--text-secondary); display: block; margin-bottom: 4px;">Data Directory</span>
          <input class="input" bind:value={dataDir} disabled style="opacity: 0.6;" />
        </div>
      </div>

      <div class="hr" style="margin: var(--space-lg) 0;"></div>

      <!-- Auth -->
      <div class="label" style="margin-bottom: var(--space-md);">Authentication</div>
      <div style="display: grid; gap: var(--space-md);">
        <label style="display: flex; align-items: center; gap: var(--space-sm); font-size: 14px; cursor: pointer;">
          <input type="checkbox" bind:checked={allowSignups} />
          Allow new signups
        </label>
      </div>

      <div class="hr" style="margin: var(--space-lg) 0;"></div>

      <!-- Server Info (read-only) -->
      <div class="label" style="margin-bottom: var(--space-md);">Server Info</div>
      <div style="display: grid; gap: var(--space-sm);">
        {#each Object.entries(settings) as [key, value]}
          <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 13px;">
            <span style="color: var(--text-secondary);">{key}</span>
            <span style="color: var(--text); font-family: var(--font-mono); font-size: 12px;">
              {typeof value === 'string' && (key.toLowerCase().includes('key') || key.toLowerCase().includes('secret'))
                ? '••••••••'
                : String(value ?? '—')}
            </span>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
