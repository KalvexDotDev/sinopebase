<script lang="ts">
  import { ROUTES, getCurrentRoute } from '../lib/router'

  let { onLogout }: { onLogout: () => void } = $props()
  let current = $state(getCurrentRoute())

  function handleClick(path: string) {
    window.location.hash = path
    current = path
  }
</script>

<nav style="width: 260px; background: var(--surface); border-right: 1px solid var(--border); padding: 1.5rem; display: flex; flex-direction: column;">
  <div style="margin-bottom: 2rem;">
    <h1 style="font-size: 1.25rem; font-weight: 700; color: var(--primary);">⚡ Sinopebase</h1>
    <p style="font-size: 0.75rem; color: var(--text-secondary);">Admin v0.2</p>
  </div>

  <ul style="list-style: none; flex: 1;">
    {#each ROUTES as route}
      <li>
        <button
          onclick={() => handleClick(route.path)}
          style="width: 100%; text-align: left; padding: 0.625rem 1rem; border: none; background: {current === route.path ? 'var(--primary)' : 'transparent'}; color: {current === route.path ? '#fff' : 'var(--text)'}; border-radius: 0.5rem; cursor: pointer; font-size: 0.875rem; margin-bottom: 0.25rem;"
        >
          {route.icon} {route.label}
        </button>
      </li>
    {/each}
  </ul>

  <button
    onclick={onLogout}
    style="padding: 0.5rem 1rem; border: 1px solid var(--border); background: transparent; color: var(--text-secondary); border-radius: 0.5rem; cursor: pointer;"
  >
    Logout
  </button>
</nav>
