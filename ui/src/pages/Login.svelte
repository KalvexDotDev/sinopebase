<script lang="ts">
import { signIn } from '../lib/api'

let { onLogin }: { onLogin: () => void } = $props()
let email = $state('')
let password = $state('')
let error = $state('')
let loading = $state(false)

async function handleSubmit(e: Event) {
  e.preventDefault()
  if (!email || !password) {
    error = 'Email and password are required'
    return
  }
  loading = true
  error = ''
  try {
    const result = await signIn(email, password)
    if (result.error) {
      error = result.error.message || 'Login failed'
    } else {
      onLogin()
    }
  } catch (err) {
    error = err instanceof Error ? err.message : 'Login failed'
  } finally {
    loading = false
  }
}
</script>

<div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: var(--bg);">
  <form
    onsubmit={handleSubmit}
    style="background: var(--surface); padding: 2.5rem; border-radius: 1rem; width: 100%; max-width: 400px; box-shadow: 0 4px 24px rgba(0,0,0,0.08);"
  >
    <h1 style="font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem;">Sinopebase Admin</h1>
    <p style="color: var(--text-secondary); margin-bottom: 2rem;">Sign in to manage your backend</p>

    {#if error}
      <div style="background: #fef2f2; color: var(--danger); padding: 0.75rem; border-radius: 0.5rem; margin-bottom: 1rem; font-size: 0.875rem;">
        {error}
      </div>
    {/if}

    <label style="display: block; margin-bottom: 0.25rem; font-weight: 500; font-size: 0.875rem;">Email</label>
    <input
      type="email"
      bind:value={email}
      placeholder="admin@example.com"
      style="width: 100%; padding: 0.625rem; border: 1px solid var(--border); border-radius: 0.5rem; margin-bottom: 1rem; background: var(--bg); color: var(--text);"
    />

    <label style="display: block; margin-bottom: 0.25rem; font-weight: 500; font-size: 0.875rem;">Password</label>
    <input
      type="password"
      bind:value={password}
      placeholder="Enter your password"
      style="width: 100%; padding: 0.625rem; border: 1px solid var(--border); border-radius: 0.5rem; margin-bottom: 1.5rem; background: var(--bg); color: var(--text);"
    />

    <button
      type="submit"
      disabled={loading}
      style="width: 100%; padding: 0.75rem; background: var(--primary); color: white; border: none; border-radius: 0.5rem; cursor: pointer; font-weight: 600; font-size: 0.875rem;"
    >
      {loading ? 'Signing in...' : 'Sign In'}
    </button>
  </form>
</div>
