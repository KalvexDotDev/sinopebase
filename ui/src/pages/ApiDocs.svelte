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

  $effect(() => { loadSpec() })

  // ── Domain grouping ──
  const DOMAINS: Array<{ prefix: string; tag: string; desc: string }> = [
    { prefix: '/auth/', tag: 'Auth', desc: 'Sign up, sign in, token management, user sessions. Powered by better-auth v1.6.' },
    { prefix: '/rest/v1/', tag: 'REST / Database', desc: 'PostgREST-compatible CRUD. Query, insert, update, delete rows with filtering, sorting, and pagination.' },
    { prefix: '/storage/v1/', tag: 'Storage', desc: 'S3-compatible file storage. Buckets, uploads, downloads, signed URLs, public/private access control.' },
    { prefix: '/realtime/', tag: 'Realtime', desc: 'Phoenix Channels over WebSocket. Subscribe to database changes, broadcast messages, presence tracking.' },
    { prefix: '/api/admin/', tag: 'Admin', desc: 'Backups, table management, RLS enable, DDL operations. Service role only.' },
    { prefix: '/api/settings', tag: 'Settings', desc: 'Read and update application configuration.' },
    { prefix: '/api/logs', tag: 'Logs', desc: 'Server-side request logs with pagination, filtering, and statistics.' },
    { prefix: '/api/collections', tag: 'Collections', desc: 'Schema management — create, update, and delete collection definitions.' },
    { prefix: '/api/crons', tag: 'Cron', desc: 'List and trigger scheduled cron jobs.' },
    { prefix: '/api/functions/', tag: 'Edge Functions', desc: 'List and invoke edge functions running in isolated Bun Workers.' },
    { prefix: '/api/mastra/', tag: 'AI / Mastra', desc: 'Chat with AI agents, streaming responses, embeddings. Powered by Mastra.' },
    { prefix: '/api/metrics', tag: 'Metrics', desc: 'Server metrics in JSON. Prometheus-compatible /metrics endpoint also available.' },
    { prefix: '/api/health', tag: 'Health', desc: 'Liveness and readiness checks. No auth required.' },
    { prefix: '/api/ready', tag: 'Health', desc: 'Database connectivity check.' },
    { prefix: '/metrics', tag: 'Metrics', desc: 'Prometheus-compatible plaintext metrics.' },
    { prefix: '/_/', tag: 'Admin UI', desc: 'Svelte 5 admin dashboard. Served at /_/' },
  ]

  function classifyPath(path: string): { tag: string; desc: string } {
    const match = DOMAINS.find((d) => path.startsWith(d.prefix))
    return match ? { tag: match.tag, desc: match.desc } : { tag: 'Other', desc: '' }
  }

  function endpointSummary(path: string, method: string, op: any): string {
    // Prefer detail from the OpenAPI spec (added via route handler detail annotations)
    if (op?.detail?.summary) return op.detail.summary
    if (op?.detail?.description) return op.detail.description.slice(0, 120)
    const m = method.toUpperCase()
    const segments = path.split('/').filter(Boolean)
    const last = segments[segments.length - 1] ?? ''
    if (m === 'GET' && last !== '') return `List ${last.replace(/-/g, ' ')}`
    if (m === 'POST') return `Create or execute ${last}`
    if (m === 'PATCH') return `Update ${last}`
    if (m === 'DELETE') return `Delete ${last}`
    if (m === 'PUT') return `Replace ${last}`
    return path
  }

  function methodColor(method: string): string {
    switch (method) {
      case 'get': return 'var(--lichen)'
      case 'post': return '#e0c46e'
      case 'patch': return '#9dc4e0'
      case 'delete': return 'var(--danger)'
      case 'put': return '#d4a0e0'
      default: return 'var(--fog)'
    }
  }

  function curlExample(path: string, method: string): string {
    const parts = [`curl '${window.location.origin}${path}'`]
    if (method !== 'get') parts.push(`-X ${method.toUpperCase()}`)
    const admin = path.includes('/admin/') || path.includes('/api/settings') || path.includes('/api/logs') || path.includes('/api/collections') || path.includes('/api/crons')
    parts.push(`-H 'Authorization: Bearer ${admin ? serviceKey : anonKey}'`)
    if (['post', 'patch', 'put'].includes(method)) parts.push(`-H 'Content-Type: application/json' -d '{...}'`)
    return parts.join(' \\\n  ')
  }

  // ── Build grouped data ──
  const grouped = $derived.by(() => {
    if (!spec?.paths) return []
    const groups = new Map<string, { tag: string; desc: string; paths: Array<{ path: string; methods: string[]; detail: any }> }>()
    for (const [path, item] of Object.entries(spec.paths) as [string, Record<string, any>][]) {
      const methods = Object.keys(item)
      const domain = classifyPath(path)
      const op = item[methods[0]!] ?? {}
      const g = groups.get(domain.tag) ?? { tag: domain.tag, desc: domain.desc, paths: [] }
      g.paths.push({ path, methods, detail: op })
      groups.set(domain.tag, g)
    }
    return Array.from(groups.values())
  })

  const filtered = $derived(search
    ? grouped.filter((g) => g.paths.some((p) => p.path.toLowerCase().includes(search.toLowerCase())))
    : grouped)
</script>

<div>
  <div class="flex items-center justify-between mb-lg" style="flex-wrap: wrap; gap: var(--space-sm);">
    <h2 style="margin: 0;">API Reference</h2>
    <input class="input input-sm" style="width: 240px;" placeholder="Search endpoints…" bind:value={search} />
  </div>

  {#if loading}
    <div class="card" style="padding: var(--space-lg);">{#each Array(4) as _}<div class="skeleton" style="height: 64px; margin-bottom: 8px;"></div>{/each}</div>
  {:else if !spec}
    <div class="card" style="text-align: center; padding: var(--space-xl);">
      <p style="color: var(--text-secondary);">Failed to load API spec from /openapi/json</p>
    </div>
  {:else}
    <div style="display: grid; gap: var(--space-xl);">
      {#each filtered as domain}
        <section>
          <div class="mb-sm">
            <h3 style="margin: 0; display: inline;">{domain.tag}</h3>
            {#if domain.desc}
              <p style="color: var(--text-secondary); font-size: 13px; margin-top: 4px; max-width: 60ch;">
                {domain.desc}
              </p>
            {/if}
          </div>
          <div style="display: grid; gap: 4px;">
            {#each domain.paths as { path, methods: verbs, detail }}
              <div class="card" style="overflow: hidden;">
                <button
                  onclick={() => { expanded = expanded === path ? '' : path }}
                  style="display: flex; align-items: center; gap: var(--space-sm); width: 100%; text-align: left;
                    padding: 10px var(--space-md); border: none; background: transparent; color: var(--text); cursor: pointer;">
                  {#each verbs as method}
                    <span style="text-transform: uppercase; font-weight: 600; font-size: 9px; letter-spacing: 0.1em;
                      padding: 2px 6px; border-radius: var(--radius-none);
                      color: {methodColor(method)}; border: 1px solid {methodColor(method)}; width: 44px; text-align: center;">{method}</span>
                  {/each}
                  <code style="flex: 1; font-size: 13px;">{path}</code>
                  <span style="color: var(--text-muted); font-size: 12px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    {endpointSummary(path, verbs[0]!, detail)}
                  </span>
                  <span style="color: var(--text-muted); font-size: 10px;">{expanded === path ? '▴' : '▾'}</span>
                </button>
                {#if expanded === path}
                  <div style="padding: 0 var(--space-md) var(--space-md) var(--space-md);">
                    {#if detail.parameters?.length > 0}
                      <div class="label" style="margin-bottom: 4px;">Parameters</div>
                      <div style="display: grid; gap: 2px; margin-bottom: var(--space-sm);">
                        {#each detail.parameters as param (param.name + param.in)}
                          <div style="display: flex; gap: var(--space-sm); font-size: 12px; padding: 3px 0;">
                            <code style="width: 100px;">{param.name}</code>
                            <span class="chip chip-muted" style="font-size: 9px;">{param.in}</span>
                            <span style="color: var(--text-muted);">{param.schema?.type ?? 'string'}{param.required ? '' : '?'}</span>
                          </div>
                        {/each}
                      </div>
                    {/if}
                    <div class="label" style="margin-bottom: 4px;">cURL</div>
                    <pre style="background: var(--char); padding: var(--space-sm); font-family: var(--font-mono); font-size: 11px;
                      color: var(--text-secondary); overflow-x: auto; line-height: 1.6; border: 1px solid var(--border); margin: 0;">{curlExample(path, verbs[0]!)}</pre>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </section>
      {/each}
    </div>
    <p style="margin-top: var(--space-xl); color: var(--text-muted); font-size: 12px;">
      {Object.keys(spec.paths ?? {}).length} endpoints · v{spec.info?.version} · Auto-generated from @elysia/openapi
    </p>
  {/if}
</div>
