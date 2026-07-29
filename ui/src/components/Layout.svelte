<script lang="ts">
  import Sidebar from './Sidebar.svelte'
  let { children, onLogout }: { children: any; onLogout: () => void } = $props()
</script>

<div style="display: flex; min-height: 100vh; background: var(--bg);">
  <Sidebar {onLogout} />
  <main style="flex: 1; padding: var(--space-xl); overflow-y: auto; background: var(--bg);">
    {#if children}
      {@render children()}
    {/if}
  </main>
</div>
