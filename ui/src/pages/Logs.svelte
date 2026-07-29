<script lang="ts">
let logs = $state<string[]>([
  '[API] GET /api/health 200 2ms',
  '[Auth] Session validated for user admin@example.com',
])

// Capture console logs
$effect(() => {
  const originalLog = console.log
  const originalError = console.error
  console.log = (...args: any[]) => {
    logs = [...logs.slice(-99), args.join(' ')]
    originalLog.apply(console, args)
  }
  console.error = (...args: any[]) => {
    logs = [...logs.slice(-99), '[ERROR] ' + args.join(' ')]
    originalError.apply(console, args)
  }
  return () => {
    console.log = originalLog
    console.error = originalError
  }
})
</script>

<div>
  <h2 style="font-size: 1.5rem; margin-bottom: 2rem;">Logs</h2>

  <div style="background: var(--surface); border-radius: 0.75rem; border: 1px solid var(--border); overflow: hidden;">
    <div style="padding: 0.75rem 1rem; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center;">
      <span style="font-weight: 600;">Console Output</span>
      <span style="font-size: 0.75rem; color: var(--text-secondary);">{logs.length} entries</span>
    </div>
    <div style="max-height: 500px; overflow-y: auto; font-family: 'Fira Code', monospace; font-size: 0.8125rem;">
      {#if logs.length === 0}
        <div style="padding: 1rem; color: var(--text-secondary);">No log entries</div>
      {:else}
        {#each logs as log, i}
          <div style="padding: 0.5rem 1rem; border-bottom: 1px solid var(--border); color: var(--text);">
            <span style="color: var(--text-secondary); margin-right: 0.5rem;">#{logs.length - i}</span>
            {log}
          </div>
        {/each}
      {/if}
    </div>
  </div>
</div>
