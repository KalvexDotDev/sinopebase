<script lang="ts">
let theme = $state(localStorage.getItem('sb-theme') || 'auto')

function setTheme(t: string) {
  theme = t
  localStorage.setItem('sb-theme', t)
}
</script>

<div>
  <h2 style="font-size: 1.5rem; margin-bottom: 2rem;">Settings</h2>

  <div style="background: var(--surface); border-radius: 0.75rem; border: 1px solid var(--border); padding: 2rem; max-width: 600px;">
    <h3 style="margin-bottom: 1rem;">Appearance</h3>
    <div style="display: flex; gap: 0.5rem; margin-bottom: 2rem;">
      <button
        onclick={() => setTheme('light')}
        style="padding: 0.5rem 1rem; border: 1px solid {theme === 'light' ? 'var(--primary)' : 'var(--border)'}; background: {theme === 'light' ? 'var(--primary)' : 'transparent'}; color: {theme === 'light' ? 'white' : 'var(--text)'}; border-radius: 0.5rem; cursor: pointer;"
      >
        Light
      </button>
      <button
        onclick={() => setTheme('dark')}
        style="padding: 0.5rem 1rem; border: 1px solid {theme === 'dark' ? 'var(--primary)' : 'var(--border)'}; background: {theme === 'dark' ? 'var(--primary)' : 'transparent'}; color: {theme === 'dark' ? 'white' : 'var(--text)'}; border-radius: 0.5rem; cursor: pointer;"
      >
        Dark
      </button>
      <button
        onclick={() => setTheme('auto')}
        style="padding: 0.5rem 1rem; border: 1px solid {theme === 'auto' ? 'var(--primary)' : 'var(--border)'}; background: {theme === 'auto' ? 'var(--primary)' : 'transparent'}; color: {theme === 'auto' ? 'white' : 'var(--text)'}; border-radius: 0.5rem; cursor: pointer;"
      >
        Auto
      </button>
    </div>

    <h3 style="margin-bottom: 1rem;">Server Info</h3>
    <div style="display: grid; gap: 0.75rem;">
      <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border);">
        <span style="color: var(--text-secondary);">Version</span>
        <span>v0.2.0</span>
      </div>
      <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border);">
        <span style="color: var(--text-secondary);">Auth Provider</span>
        <span>better-auth</span>
      </div>
      <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border);">
        <span style="color: var(--text-secondary);">Database</span>
        <span>PostgreSQL</span>
      </div>
      <div style="display: flex; justify-content: space-between; padding: 0.5rem 0;">
        <span style="color: var(--text-secondary);">Storage</span>
        <span>RustFS / S3</span>
      </div>
    </div>
  </div>
</div>
