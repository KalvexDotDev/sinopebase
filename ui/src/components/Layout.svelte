<script lang="ts">
  import Sidebar from './Sidebar.svelte'

  let { children, onLogout }: { children: any; onLogout: () => void } = $props()
</script>

<div style="display: flex; min-height: 100vh;">
  <Sidebar {onLogout} />
  <main style="flex: 1; padding: 2rem; overflow-y: auto;">
    {#if children}
      {@render children()}
    {/if}
  </main>
</div>
