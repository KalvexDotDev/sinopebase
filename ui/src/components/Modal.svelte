<script lang="ts">
  let { title = '', open = false, variant = 'center', onclose, children }: {
    title?: string
    open: boolean
    variant?: 'center' | 'slide'
    onclose?: () => void
    children?: any
  } = $props()
</script>

{#if open}
  {#if variant === 'slide'}
    <div style="position: fixed; inset: 0; z-index: 100; display: flex;">
      <div style="flex: 1; background: rgba(0,0,0,0.5);" onclick={onclose}></div>
      <div class="card" style="width: 420px; max-width: 90vw; border-left: 1px solid var(--border); display: flex; flex-direction: column; overflow-y: auto; border-radius: 0;">
        {#if title}
          <div style="padding: var(--space-lg); border-bottom: 1px solid var(--border);">
            <h3 style="margin: 0;">{title}</h3>
          </div>
        {/if}
        {#if children}{@render children()}{/if}
      </div>
    </div>
  {:else}
    <div style="position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100;">
      <div class="card" style="max-width: 420px; width: 90%; padding: var(--space-lg);">
        {#if title}<h3 style="margin-bottom: var(--space-sm);">{title}</h3>{/if}
        {#if children}{@render children()}{/if}
      </div>
    </div>
  {:else}
    {#if children}{@render children()}{/if}
  {/if}
{/if}
