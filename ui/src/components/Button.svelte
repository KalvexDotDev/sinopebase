<script lang="ts">
  let { variant = 'ghost', size = 'md', onclick, disabled = false, children }: {
    variant?: 'primary' | 'ghost' | 'danger' | 'icon'
    size?: 'sm' | 'md'
    onclick?: (e: MouseEvent) => void
    disabled?: boolean
    children?: any
  } = $props()
  const { children: _c, onclick: _o, ...rest } = $props()

  const cls = $derived(`btn-${variant}`)
</script>

<button type="button" {disabled} {...rest} class={cls} style="height: {size === 'sm' ? '28px' : variant === 'icon' ? '32px' : '44px'}; font-size: {size === 'sm' ? '11px' : '13px'};"
  onclick={onclick}>
  {#if children}{@render children()}{/if}
</button>
