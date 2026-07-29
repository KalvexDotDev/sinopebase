<script lang="ts">
  import { signIn, setServiceRoleKey, getServiceRoleKey } from '../lib/api'

  let { onLogin }: { onLogin: () => void } = $props()
  let email = $state('')
  let password = $state('')
  let serviceKey = $state('')
  let error = $state('')
  let loading = $state(false)
  let mode = $state<'password' | 'service_role'>('service_role')

  async function handleSubmit(e: Event) {
    e.preventDefault()
    loading = true
    error = ''

    try {
      if (mode === 'service_role') {
        if (!serviceKey.trim()) {
          error = 'Service role key is required'
          loading = false
          return
        }
        setServiceRoleKey(serviceKey.trim())
        // Verify the key works before proceeding
        const res = await fetch(window.location.origin + '/api/health', {
          headers: { Authorization: `Bearer ${serviceKey.trim()}` },
        })
        if (!res.ok) {
          setServiceRoleKey('')
          error = 'Invalid service role key'
          loading = false
          return
        }
        onLogin()
      } else {
        if (!email || !password) {
          error = 'Email and password are required'
          loading = false
          return
        }
        const result = await signIn(email, password)
        if (result.error) {
          error = result.error.message || 'Login failed'
        } else {
          onLogin()
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Login failed'
    } finally {
      loading = false
    }
  }

  $effect(() => {
    // If already have a stored key, try auto-login
    const stored = getServiceRoleKey()
    if (stored) {
      serviceKey = stored
      // Auto-verify in background
    }
  })
</script>

<div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: var(--bg);">
  <form
    onsubmit={handleSubmit}
    style="background: var(--surface); padding: 2.5rem; border-radius: 1rem; width: 100%; max-width: 440px; box-shadow: 0 4px 24px rgba(0,0,0,0.08);"
  >
    <h1 style="font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem;">Sinopebase Admin</h1>
    <p style="color: var(--text-secondary); margin-bottom: 2rem;">Sign in to manage your backend</p>

    {#if error}
      <div style="background: #fef2f2; color: var(--danger); padding: 0.75rem; border-radius: 0.5rem; margin-bottom: 1rem; font-size: 0.875rem;">
        {error}
      </div>
    {/if}

    <!-- Auth mode tabs -->
    <div style="display: flex; margin-bottom: 1.5rem; border: 1px solid var(--border); border-radius: 0.5rem; overflow: hidden;">
      <button
        type="button"
        onclick={() => { mode = 'service_role'; error = '' }}
        style="flex: 1; padding: 0.5rem; border: none; background: {mode === 'service_role' ? 'var(--primary)' : 'transparent'}; color: {mode === 'service_role' ? '#fff' : 'var(--text)'}; cursor: pointer; font-size: 0.8125rem; font-weight: 500;"
      >
        Service Role Key
      </button>
      <button
        type="button"
        onclick={() => { mode = 'password'; error = '' }}
        style="flex: 1; padding: 0.5rem; border: none; background: {mode === 'password' ? 'var(--primary)' : 'transparent'}; color: {mode === 'password' ? '#fff' : 'var(--text)'}; cursor: pointer; font-size: 0.8125rem; font-weight: 500;"
      >
        Email / Password
      </button>
    </div>

    {#if mode === 'service_role'}
      <label for="service-key-input" style="display: block; margin-bottom: 0.25rem; font-weight: 500; font-size: 0.875rem;">Service Role Key</label>
      <input
        id="service-key-input"
        type="password"
        bind:value={serviceKey}
        placeholder="sb_service_role_..."
        style="width: 100%; padding: 0.625rem; border: 1px solid var(--border); border-radius: 0.5rem; margin-bottom: 1.5rem; background: var(--bg); color: var(--text); font-family: monospace;"
      />
      <p style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 1rem;">
        Find this in your environment variables (<code>SINOPEBASE_SERVICE_ROLE_KEY</code>) or <code>.env</code> file.
      </p>
    {:else}
      <label for="login-email" style="display: block; margin-bottom: 0.25rem; font-weight: 500; font-size: 0.875rem;">Email</label>
      <input
        id="login-email"
        type="email"
        bind:value={email}
        placeholder="admin@example.com"
        style="width: 100%; padding: 0.625rem; border: 1px solid var(--border); border-radius: 0.5rem; margin-bottom: 1rem; background: var(--bg); color: var(--text);"
      />

      <label for="login-password" style="display: block; margin-bottom: 0.25rem; font-weight: 500; font-size: 0.875rem;">Password</label>
      <input
        id="login-password"
        type="password"
        bind:value={password}
        placeholder="Enter your password"
        style="width: 100%; padding: 0.625rem; border: 1px solid var(--border); border-radius: 0.5rem; margin-bottom: 1.5rem; background: var(--bg); color: var(--text);"
      />
    {/if}

    <button
      type="submit"
      disabled={loading}
      style="width: 100%; padding: 0.75rem; background: var(--primary); color: white; border: none; border-radius: 0.5rem; cursor: pointer; font-weight: 600; font-size: 0.875rem;"
    >
      {loading ? 'Signing in...' : 'Sign In'}
    </button>
  </form>
</div>
