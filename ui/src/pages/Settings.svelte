<script lang="ts">
  import { getSettings, updateSettings, listOAuthProviders, addOAuthProvider, updateOAuthProvider, deleteOAuthProvider, type OAuthProvider } from '../lib/api'
  import Button from '../components/Button.svelte'

  let settings = $state<Record<string, unknown>>({})
  let loading = $state(true)
  let saving = $state(false)
  let error = $state('')
  let success = $state('')

  let appName = $state('')
  let serverPort = $state('')
  let dataDir = $state('')
  let allowSignups = $state(false)

  // ── OAuth providers ──
  let providers = $state<OAuthProvider[]>([])
  let providersLoading = $state(false)
  let providersError = $state('')
  let showProviderForm = $state(false)
  let editingProviderId = $state<string | null>(null)
  let restartNeeded = $state(false)

  // Form fields
  let formProviderId = $state('')
  let customProviderId = $state('')
  let formClientId = $state('')
  let formClientSecret = $state('')
  let formTenantId = $state('')
  let formIssuer = $state('')
  let formSubmitting = $state(false)
  let formError = $state('')

  // Built-in provider options with labels
  const BUILTIN_PROVIDERS = [
    { id: 'google', label: 'Google' },
    { id: 'github', label: 'GitHub' },
    { id: 'discord', label: 'Discord' },
    { id: 'apple', label: 'Apple' },
    { id: 'microsoft', label: 'Microsoft' },
    { id: 'spotify', label: 'Spotify' },
    { id: 'gitlab', label: 'GitLab' },
    { id: 'bitbucket', label: 'Bitbucket' },
    { id: 'twitch', label: 'Twitch' },
    { id: 'linkedin', label: 'LinkedIn' },
    { id: 'dropbox', label: 'Dropbox' },
  ]

  const PROVIDER_LABEL: Record<string, string> = Object.fromEntries(
    BUILTIN_PROVIDERS.map((p) => [p.id, p.label]),
  )

  function providerLabel(id: string) {
    return PROVIDER_LABEL[id] ?? id.charAt(0).toUpperCase() + id.slice(1)
  }

  function isBuiltin(id: string) {
    return id in PROVIDER_LABEL
  }

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
    loadProviders()
  }

  async function loadProviders() {
    providersLoading = true; providersError = ''
    const result = await listOAuthProviders()
    if (result.data) {
      providers = result.data.providers ?? []
      restartNeeded = result.data.restartRequired ?? false
    } else if (result.error) {
      providersError = result.error.message
    }
    providersLoading = false
  }

  async function save() {
    saving = true; error = ''; success = ''
    const result = await updateSettings({ appName, port: parseInt(serverPort, 10), dataDir, allowSignups })
    if (result.error) error = result.error.message
    else success = 'Settings saved successfully'
    saving = false
  }

  function openAddForm() {
    editingProviderId = null
    formProviderId = ''
    customProviderId = ''
    formClientId = ''
    formClientSecret = ''
    formTenantId = ''
    formIssuer = ''
    formError = ''
    showProviderForm = true
  }

  function effectiveProviderId() {
    return formProviderId === '__custom__' ? customProviderId : formProviderId
  }

  function openEditForm(p: OAuthProvider) {
    editingProviderId = p.providerId
    formProviderId = p.providerId
    formClientId = p.clientId
    formClientSecret = ''
    formTenantId = p.tenantId ?? ''
    formIssuer = p.issuer ?? ''
    formError = ''
    showProviderForm = true
  }

  async function submitProvider() {
    formSubmitting = true; formError = ''
    if (!formProviderId || !formClientId) {
      formError = 'Provider ID and Client ID are required.'
      formSubmitting = false
      return
    }
    const actualProviderId = effectiveProviderId()
    if (!actualProviderId || actualProviderId === '__custom__') {
      formError = 'Please select a provider or enter a custom provider ID.'
      formSubmitting = false
      return
    }
    if (!editingProviderId && !formClientSecret) {
      formError = 'Client Secret is required for new providers.'
      formSubmitting = false
      return
    }

    const payload: OAuthProvider = {
      providerId: actualProviderId,
      clientId: formClientId,
      clientSecret: formClientSecret || '',
    }
    if (formTenantId) payload.tenantId = formTenantId
    if (formIssuer) payload.issuer = formIssuer

    if (editingProviderId) {
      // Update — only send changed fields
      const updateData: Partial<OAuthProvider> = { clientId: formClientId }
      if (formClientSecret) updateData.clientSecret = formClientSecret
      if (formTenantId !== undefined) updateData.tenantId = formTenantId || undefined
      if (formIssuer !== undefined) updateData.issuer = formIssuer || undefined
      const result = await updateOAuthProvider(editingProviderId, updateData)
      if (result.error) { formError = result.error.message; formSubmitting = false; return }
      restartNeeded = result.data?.restartRequired ?? true
    } else {
      const result = await addOAuthProvider(payload)
      if (result.error) { formError = result.error.message; formSubmitting = false; return }
      restartNeeded = result.data?.restartRequired ?? true
    }
    showProviderForm = false
    formSubmitting = false
    await loadProviders()
  }

  async function removeProvider(providerId: string) {
    if (!confirm(`Remove OAuth provider "${providerLabel(providerId)}"? This requires a server restart to take effect.`)) return
    const result = await deleteOAuthProvider(providerId)
    if (result.error) { providersError = result.error.message; return }
    restartNeeded = result.data?.restartRequired ?? true
    await loadProviders()
  }

  $effect(() => { load() })
</script>

<div>
  <div class="flex items-center justify-between mb-lg">
    <h2 style="margin: 0;">Settings</h2>
    <Button variant="primary" size="sm" disabled={saving}
      onclick={save}>
      {saving ? 'Saving…' : 'Save Changes'}
    </Button>
  </div>

  {#if error}<div class="toast toast-error" style="margin-bottom: var(--space-md);">{error}</div>{/if}
  {#if success}<div class="toast toast-success" style="margin-bottom: var(--space-md);">{success}</div>{/if}

  {#if restartNeeded}
    <div class="toast" style="margin-bottom: var(--space-md); background: var(--accent); color: var(--bg); padding: 0.75rem 1rem; border-radius: 0.5rem; font-size: 0.8125rem; display: flex; align-items: center; gap: 0.5rem;">
      ⚡ OAuth provider changes saved. <strong>Restart the server</strong> for changes to take effect.
    </div>
  {/if}

  {#if loading}
    <div class="card" style="padding: var(--space-lg);">
      {#each Array(5) as _}<div class="skeleton" style="height: 40px; margin-bottom: 12px;"></div>{/each}
    </div>
  {:else}
    <div class="card" style="max-width: 700px;">
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

      <!-- OAuth Providers -->
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-md);">
        <div class="label">OAuth Providers</div>
        <Button variant="primary" size="sm" onclick={openAddForm}>Add Provider</Button>
      </div>
      <p style="font-size: 12px; color: var(--text-secondary); margin-bottom: var(--space-md);">
        Configure social login providers (Google, GitHub, Discord) and enterprise SSO (Keycloak, Okta, Auth0).
        Changes require a server restart.
      </p>

      {#if providersError}
        <div class="toast toast-error" style="margin-bottom: var(--space-md);">{providersError}</div>
      {/if}

      {#if providersLoading}
        <div style="padding: var(--space-md); text-align: center; color: var(--text-secondary);">Loading…</div>
      {:else if providers.length === 0}
        <div style="padding: var(--space-lg); text-align: center; color: var(--text-secondary); border: 1px dashed var(--border); border-radius: 0.5rem; font-size: 0.875rem;">
          No OAuth providers configured. Click "Add Provider" to set one up.
        </div>
      {:else}
        <div style="display: grid; gap: var(--space-sm);">
          {#each providers as p (p.providerId)}
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.625rem 0.75rem; background: var(--bg); border: 1px solid var(--border); border-radius: 0.5rem; font-size: 0.8125rem;">
              <div style="display: flex; align-items: center; gap: 0.625rem;">
                <span style="display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; background: {isBuiltin(p.providerId) ? '#f4f1ea' : '#666'}; color: var(--bg); font-size: 0.6875rem; font-weight: 700;">
                  {providerLabel(p.providerId)[0] ?? '?'}
                </span>
                <div>
                  <div style="font-weight: 600;">{providerLabel(p.providerId)}</div>
                  <div style="font-size: 0.6875rem; color: var(--text-secondary); font-family: var(--font-mono);">
                    {isBuiltin(p.providerId) ? 'Built-in social' : 'Generic OIDC'}
                    {#if p.issuer} · {p.issuer}{/if}
                    {#if p.tenantId} · tenant: {p.tenantId}{/if}
                  </div>
                </div>
              </div>
              <div style="display: flex; gap: 0.375rem;">
                <Button variant="ghost" size="xs" onclick={() => openEditForm(p)}>Edit</Button>
                <Button variant="ghost" size="xs" onclick={() => removeProvider(p.providerId)}>Remove</Button>
              </div>
            </div>
          {/each}
        </div>
      {/if}

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

<!-- Provider Add/Edit Modal -->
{#if showProviderForm}
  <div
    style="position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 100;"
    onclick={(e) => { if (e.target === e.currentTarget) showProviderForm = false }}
    onkeydown={(e) => { if (e.key === 'Escape') showProviderForm = false }}
  >
    <div style="background: var(--surface); border-radius: 0.75rem; padding: 1.5rem; width: 100%; max-width: 480px; box-shadow: 0 8px 32px rgba(0,0,0,0.2);" role="dialog">
      <h3 style="margin: 0 0 1rem 0; font-size: 1.125rem;">
        {editingProviderId ? `Edit ${providerLabel(editingProviderId)}` : 'Add OAuth Provider'}
      </h3>

      {#if formError}
        <div class="toast toast-error" style="margin-bottom: 1rem;">{formError}</div>
      {/if}

      <div style="display: grid; gap: 0.875rem;">
        <!-- Provider ID -->
        <div>
          <span style="font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 2px;">Provider</span>
          {#if editingProviderId}
            <input class="input" value={providerLabel(formProviderId)} disabled style="opacity: 0.6;" />
          {:else}
            <select class="input" bind:value={formProviderId} style="width: 100%;">
              <option value="">— Select a provider —</option>
              {#each BUILTIN_PROVIDERS as p (p.id)}
                <option value={p.id}>{p.label}</option>
              {/each}
              <option value="__custom__">Custom (OIDC)…</option>
            </select>
            {#if formProviderId === '__custom__'}
              <input class="input" bind:value={customProviderId} placeholder="e.g. keycloak, okta, auth0" style="margin-top: 0.5rem;" />
            {/if}
          {/if}
        </div>

        <!-- Client ID -->
        <div>
          <span style="font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 2px;">Client ID</span>
          <input class="input" bind:value={formClientId} placeholder="Your OAuth app's client ID" />
        </div>

        <!-- Client Secret -->
        <div>
          <span style="font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 2px;">Client Secret {editingProviderId ? '(leave blank to keep current)' : ''}</span>
          <input class="input" type="password" bind:value={formClientSecret} placeholder={editingProviderId ? '•••••••• (unchanged)' : 'Your OAuth app\'s client secret'} />
        </div>

        <!-- Issuer (OIDC) -->
        <div>
          <span style="font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 2px;">Issuer URL <span style="opacity: 0.6;">(OIDC providers only)</span></span>
          <input class="input" bind:value={formIssuer} placeholder="e.g. https://accounts.google.com" />
        </div>

        <!-- Tenant ID (Entra ID) -->
        <div>
          <span style="font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 2px;">Tenant ID <span style="opacity: 0.6;">(Microsoft Entra ID only)</span></span>
          <input class="input" bind:value={formTenantId} placeholder="e.g. common, organizations, or tenant UUID" />
        </div>
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1.25rem;">
        <Button variant="ghost" size="sm" onclick={() => { showProviderForm = false }}>Cancel</Button>
        <Button variant="primary" size="sm" disabled={formSubmitting} onclick={submitProvider}>
          {formSubmitting ? 'Saving…' : editingProviderId ? 'Save Changes' : 'Add Provider'}
        </Button>
      </div>
    </div>
  </div>
{/if}
