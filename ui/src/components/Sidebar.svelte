<script lang="ts">
  import { ROUTES, getCurrentRoute } from '../lib/router'

  let { onLogout }: { onLogout: () => void } = $props()
  let current = $state(getCurrentRoute())

  // React to hash changes
  $effect(() => {
    const handler = () => { current = getCurrentRoute() }
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  })

  function handleClick(path: string) {
    window.location.hash = path
    current = path
  }
</script>

<nav style="width: 240px; flex-shrink: 0; background: var(--ink); border-right: 1px solid var(--border); display: flex; flex-direction: column; min-height: 100vh;">
  <!-- Brand -->
  <div style="padding: var(--space-lg); border-bottom: 1px solid var(--border);">
    <h1 style="font-family: var(--font-display); font-size: 22px; font-weight: 500; color: var(--primary); margin: 0; line-height: 1.2;">
      Sinopebase
    </h1>
    <p style="font-family: var(--font-ui); font-size: 11px; color: var(--text-muted); letter-spacing: 0.08em; margin-top: 2px;">
      Admin v0.5
    </p>
  </div>

  <!-- Nav links -->
  <div style="flex: 1; overflow-y: auto; padding: var(--space-sm);">
    {#each ROUTES as route (route.path)}
      <button
        onclick={() => handleClick(route.path)}
        style="display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
          padding: 8px 12px; border: none;
          background: {current === route.path ? 'var(--char)' : 'transparent'};
          color: {current === route.path ? 'var(--text)' : 'var(--text-secondary)'};
          border-radius: var(--radius-none); cursor: pointer;
          font-family: var(--font-ui); font-size: 13px; font-weight: 500;
          margin-bottom: 1px; transition: background 0.12s ease, color 0.12s ease;"
      >
        <span style="font-size: 14px; width: 20px; text-align: center;">{route.icon}</span>
        {route.label}
        {#if current === route.path}
          <span style="margin-left: auto; width: 4px; height: 4px; border-radius: 50%; background: var(--lichen);"></span>
        {/if}
      </button>
    {/each}
  </div>

  <!-- Footer -->
  <div style="padding: var(--space-md); border-top: 1px solid var(--border);">
    <button
      onclick={onLogout}
      style="width: 100%; padding: 8px 12px; border: 1px solid var(--border);
        background: transparent; color: var(--text-secondary); border-radius: var(--radius-none);
        cursor: pointer; font-family: var(--font-ui); font-size: 13px; transition: color 0.18s ease, border-color 0.18s ease;"
    >
      Sign Out
    </button>
  </div>
</nav>
