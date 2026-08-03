<script lang="ts">
  import { signIn, setServiceRoleKey, getServiceRoleKey } from '../lib/api'

  let { onLogin }: { onLogin: () => void } = $props()
  let email = $state('')
  let password = $state('')
  let serviceKey = $state(getServiceRoleKey() ?? '')
  let error = $state('')
  let loading = $state(false)
  let mode = $state<'password' | 'service_role'>('service_role')

  // OAuth providers — mirrored from server config.
  // Providers only appear when their env vars are set (checked at page load).
  const oauthProviders = $state<Array<{ id: string; label: string; color: string }>>([])

  async function checkOAuthProviders() {
    // Try to fetch available OAuth providers from the server
    try {
      const res = await fetch(window.location.origin + '/api/auth/oauth-providers')
      if (res.ok) {
        const data = await res.json()
        oauthProviders.push(...(data.providers ?? []))
      }
    } catch {
      // Server doesn't expose provider list yet — try common defaults
      // by probing the better-auth endpoints
    }
  }

  // Check for OAuth providers on mount.
  // v0.7: OAuth works in production via session-exchange (B3). The callback
  // redirects to /_/ with a better-auth session cookie, App.svelte calls
  // /api/auth/exchange to get a Bearer token, and the user lands authenticated.
  $effect(() => {
    checkOAuthProviders()
  })

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

  function signInWithOAuth(provider: string) {
    // Use a relative callback URL — better-auth validates against trustedOrigins
    window.location.href = `${window.location.origin}/api/auth/sign-in/social?provider=${provider}&callbackURL=${encodeURIComponent('/_/')}`
  }
</script>

<div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: var(--bg);">
  <form
    onsubmit={handleSubmit}
    style="background: var(--surface); padding: 2.5rem; border-radius: 1rem; width: 100%; max-width: 440px; box-shadow: 0 4px 24px rgba(0,0,0,0.08);"
  >
    <h1 style="font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem;">Sinopebase Admin</h1>
    <p style="color: var(--text-secondary); margin-bottom: 2rem;">Sign in to manage your backend</p>

    {#if error}
      <div style="background: var(--bg); color: var(--text); border: 1px solid var(--danger); padding: 0.75rem; border-radius: 0.5rem; margin-bottom: 1rem; font-size: 0.875rem;">
        {error}
      </div>
    {/if}

    <!-- OAuth provider buttons -->
    {#if oauthProviders.length > 0}
      <div style="margin-bottom: 1.5rem;">
        {#each oauthProviders as provider (provider.id)}
          <button
            type="button"
            onclick={() => signInWithOAuth(provider.id)}
            style="width: 100%; padding: 0.625rem; border: 1px solid var(--border); border-radius: 0.5rem; margin-bottom: 0.5rem; background: var(--bg); color: var(--text); cursor: pointer; font-size: 0.875rem; display: flex; align-items: center; justify-content: center; gap: 0.5rem;"
          >
            <span style="display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; background: {provider.color}; color: white; font-size: 0.75rem; font-weight: 700;">
              {provider.label[0] ?? '?'}
            </span>
            Sign in with {provider.label}
          </button>
        {/each}
        <div style="display: flex; align-items: center; gap: 0.75rem; margin: 1rem 0;">
          <hr style="flex: 1; border: none; border-top: 1px solid var(--border);" />
          <span style="font-size: 0.75rem; color: var(--text-secondary);">or</span>
          <hr style="flex: 1; border: none; border-top: 1px solid var(--border);" />
        </div>
      </div>
    {/if}

    <!-- Auth mode tabs -->
    <div style="display: flex; margin-bottom: 1.5rem; border: 1px solid var(--border); border-radius: 0.5rem; overflow: hidden;">
      <button
        type="button"
        onclick={() => { mode = 'service_role'; error = '' }}
        style="flex: 1; padding: 0.5rem; border: none; cursor: pointer; font-size: 0.8125rem; font-weight: 500; background: {mode === 'service_role' ? '#f4f1ea' : 'transparent'}; color: {mode === 'service_role' ? '#0b0c0e' : '#f4f1ea'};"
      >
        Service Role Key
      </button>
      <button
        type="button"
        onclick={() => { mode = 'password'; error = '' }}
        style="flex: 1; padding: 0.5rem; border: none; cursor: pointer; font-size: 0.8125rem; font-weight: 500; background: {mode === 'password' ? '#f4f1ea' : 'transparent'}; color: {mode === 'password' ? '#0b0c0e' : '#f4f1ea'};"
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
      style="width: 100%; padding: 0.75rem; background: #f4f1ea; color: #0b0c0e; border: none; border-radius: 0.5rem; cursor: pointer; font-weight: 600; font-size: 0.875rem;"
    >
      {loading ? 'Signing in...' : 'Sign In'}
    </button>
  </form>
</div>
