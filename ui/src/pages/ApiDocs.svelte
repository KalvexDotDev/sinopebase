<script lang="ts">
  import { getServiceRoleKey, getAnonKey } from '../lib/api'

  let spec = $state<any>(null)
  let loading = $state(true)
  let expanded = $state('')
  let search = $state('')

  const serviceKey = $derived(getServiceRoleKey() || 'YOUR_SERVICE_ROLE_KEY')
  const anonKey = $derived(getAnonKey() || 'YOUR_ANON_KEY')

  async function loadSpec() {
    try {
      const res = await fetch(`${window.location.origin}/openapi/json`)
      spec = await res.json()
    } catch { spec = null }
    loading = false
  }

  function methods(path: string): string[] {
    return Object.keys(spec.paths?.[path] ?? {})
  }

  function tagColor(method: string): string {
    switch (method) {
      case 'get': return 'var(--lichen)'
      case 'post': return '#e0c46e'
      case 'patch': return '#9dc4e0'
      case 'delete': return 'var(--danger)'
      case 'put': return '#d4a0e0'
      default: return 'var(--fog)'
    }
  }

  function groupedPaths(): Array<{ tag: string; paths: Array<{ path: string; methods: string[]; detail: any }> }> {
    if (!spec?.paths) return []
    const groups = new Map<string, Array<{ path: string; methods: string[]; detail: any }>>()
    for (const [path, item] of Object.entries(spec.paths)) {
      const verbs = methods(path)
      const op = (item as any)[verbs[0]!] ?? {}
      const tag = op.tags?.[0] ?? verbs[0]?.toUpperCase() ?? 'Other'
      const group = groups.get(tag) ?? []
      group.push({ path, methods: verbs, detail: op })
      groups.set(tag, group)
    }
    return Array.from(groups.entries()).map(([tag, paths]) => ({ tag, paths }))
  }

  function curlExample(path: string, method: string, op: any): string {
    const hasBody = op.requestBody?.content?.['application/json']?.schema
    const hasParams = op.parameters?.length > 0
    const key = path.includes('/admin/') || path.includes('/api/') ? serviceKey : anonKey
    let cmd = `curl '${window.location.origin}${path}'`
    if (method !== 'get') cmd += ` \\\n  -X ${method.toUpperCase()}`
    cmd += ` \\\n  -H 'Authorization: Bearer ${key}'`
    if (hasBody) cmd += ` \\\n  -H 'Content-Type: application/json' \\\n  -d '{...}'`
    return cmd
  }

  const grouped = $derived(groupedPaths())
  const filtered = $derived(search
    ? grouped.flatMap((g) => ({
        tag: g.tag,
        paths: g.paths.filter((p) => p.path.toLowerCase().includes(search.toLowerCase())),
      })).filter((g) => g.paths.length > 0)
    : grouped)

  $effect(() => { loadSpec() })
</script>

<div>
  <div class="flex items-center justify-between mb-lg" style="flex-wrap: wrap; gap: var(--space-sm);">
    <h2 style="margin: 0;">API Documentation</h2>
    <input class="input input-sm" style="width: 240px;" placeholder="Search endpoints…" bind:value={search} />
  </div>

  {#if loading}
    <div class="card" style="padding: var(--space-lg);">{#each Array(5) as _}<div class="skeleton" style="height: 80px; margin-bottom: 8px;"></div>{/each}</div>
  {:else if !spec}
    <div class="card" style="text-align: center; padding: var(--space-xl);">
      <p style="color: var(--text-secondary);">Failed to load API spec from /openapi/json</p>
      <p style="color: var(--text-muted); font-size: 13px;">Ensure @elysia/openapi is installed and wired.</p>
    </div>
  {:else}
    <div style="display: grid; gap: var(--space-md);">
      {#each filtered as group}
        <div>
          <div class="label" style="margin-bottom: var(--space-sm);">{group.tag}</div>
          {#each group.paths as { path, methods: verbs, detail }}
            <div class="card mb-sm" style="overflow: hidden;">
              <button
                onclick={() => { expanded = expanded === path ? '' : path }}
                style="display: flex; align-items: center; gap: var(--space-sm); width: 100%; text-align: left;
                  padding: var(--space-md) var(--space-lg); border: none; background: transparent; color: var(--text); cursor: pointer;">
                {#each verbs as method}
                  <span style="text-transform: uppercase; font-weight: 600; font-size: 10px; letter-spacing: 0.08em;
                    padding: 2px 8px; border-radius: var(--radius-none);
                    color: {tagColor(method)}; border: 1px solid {tagColor(method)};">{method}</span>
                {/each}
                <code style="flex: 1; font-size: 13px;">{path}</code>
                <span style="color: var(--text-muted); font-size: 11px;">{expanded === path ? '▴' : '▾'}</span>
              </button>
              {#if expanded === path}
                <div style="padding: 0 var(--space-lg) var(--space-lg) var(--space-lg);">
                  {#if detail.summary}
                    <p style="color: var(--text-secondary); font-size: 13px; margin-bottom: var(--space-md);">{detail.summary}</p>
                  {/if}
                  {#if detail.parameters?.length > 0}
                    <div class="label mb-sm">Parameters</div>
                    <div style="display: grid; gap: 4px; margin-bottom: var(--space-md);">
                      {#each detail.parameters as param (param.name + param.in)}
                        <div style="display: flex; gap: var(--space-sm); font-size: 12px; padding: 4px 0; border-bottom: 1px solid var(--border);">
                          <code style="width: 120px;">{param.name}</code>
                          <span class="chip chip-muted" style="font-size: 9px;">{param.in}</span>
                          <span style="color: var(--text-muted);">{param.schema?.type ?? 'string'}{param.required ? '' : '?'}</span>
                          <span style="color: var(--text-secondary); flex: 1;">{param.description ?? ''}</span>
                        </div>
                      {/each}
                    </div>
                  {/if}
                  <div class="label mb-sm">Example</div>
                  <pre style="background: var(--char); padding: var(--space-md); font-family: var(--font-mono); font-size: 11px;
                    color: var(--text-secondary); overflow-x: auto; line-height: 1.7; border: 1px solid var(--border);">{curlExample(path, verbs[0]!, detail)}</pre>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/each}
    </div>
    <p style="margin-top: var(--space-lg); color: var(--text-muted); font-size: 12px;">
      Spec version {spec.info?.version} · {Object.keys(spec.paths ?? {}).length} endpoints · Auto-generated from routes
    </p>
  {/if}
</div>
