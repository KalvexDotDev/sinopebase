<script lang="ts">
  import { listFunctions, getServiceRoleKey } from '../lib/api'
  import Button from '../components/Button.svelte'

  let functions = $state<Array<{ name: string; path: string; size: number }>>([])
  let loading = $state(true)
  let invokeResult = $state('')
  let invokeName = $state('')

  const token = $derived(getServiceRoleKey())
  const origin = window.location.origin

  async function load() {
    const r = await listFunctions()
    if (r.data) {
      functions = Array.isArray(r.data) ? r.data : r.data.data || []
    }
    loading = false
  }

  async function testInvoke(fnName: string) {
    invokeName = fnName; invokeResult = 'Invoking…'
    try {
      const res = await fetch(`${origin}/api/functions/v1/${fnName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ name: 'Tester' }),
      })
      invokeResult = await res.text()
    } catch (e: any) { invokeResult = `Error: ${e.message}` }
    invokeName = ''
  }

  $effect(() => { load() })
</script>

<div>
  <div class="flex items-center justify-between mb-lg">
    <div>
      <h2 style="margin: 0;">Edge Functions</h2>
      <p class="label" style="margin-top: 4px;">Bun Worker functions in <code>functions/</code></p>
    </div>
  </div>

  {#if loading}
    <div class="card" style="padding: var(--space-lg);">{#each Array(3) as _}<div class="skeleton" style="height: 36px; margin-bottom: 6px;"></div>{/each}</div>
  {:else if functions.length === 0}
    <div class="card" style="text-align: center; padding: var(--space-xl);">
      <p style="color: var(--text-secondary); font-size: 15px; margin-bottom: var(--space-sm);">No edge functions deployed.</p>
      <p style="color: var(--text-muted); font-size: 13px;">
        Create <code>.ts</code> files in <code>functions/</code> to get started.
        Each file exports a default <code>{{ fetch(req: Request): Response }}</code> handler.
      </p>
    </div>
  {:else}
    <div class="table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Path</th><th>Size</th><th></th></tr></thead>
        <tbody>
          {#each functions as fn (fn.name)}
            <tr>
              <td><code style="font-size: 14px;">{fn.name}</code></td>
              <td style="color: var(--text-muted); font-size: 12px;"><code>{fn.path}</code></td>
              <td style="color: var(--text-muted);">{fn.size} bytes</td>
              <td>
                <Button variant="ghost" size="sm" disabled={invokeName === fn.name}
                  onclick={() => testInvoke(fn.name)}>
                  {invokeName === fn.name ? '…' : 'Test'}
                </Button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if invokeResult}
      <div class="card" style="margin-top: var(--space-md); padding: var(--space-lg);">
        <div class="label" style="margin-bottom: 4px;">Response</div>
        <pre style="font-family: var(--font-mono); font-size: 12px; color: var(--text-secondary); white-space: pre-wrap; margin: 0;">{invokeResult}</pre>
      </div>
    {/if}
  {/if}
</div>
