<script lang="ts">
  let wsStatus = $state<'connected' | 'disconnected'>('disconnected')
  let messageCount = $state(0)
  let subscriptions = $state<string[]>([])
  let todoCount = $state(0)
  let messages = $state<Array<{ time: string; topic: string; event: string }>>([])

  // Connect for monitoring
  $effect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const token = localStorage.getItem('sb-service-role-key') || ''
    const ws = new WebSocket(`${protocol}//${window.location.host}/realtime/v1/websocket?apikey=${token}`)
    let ref = 1

    ws.onopen = () => {
      wsStatus = 'connected'
      // Subscribe to all postgres_changes on public schema
      const join = { topic: 'realtime:public:todos', event: 'phx_join', payload: { access_token: token, config: { postgres_changes: [{ event: '*', schema: 'public', table: 'todos' }] } }, ref: String(ref++) }
      ws.send(JSON.stringify(join))
      subscriptions = ['public:todos (postgres_changes)']
    }
    ws.onclose = () => { wsStatus = 'disconnected'; subscriptions = [] }
    ws.onmessage = (e) => {
      messageCount++
      try {
        const data = JSON.parse(e.data)
        const msg = Array.isArray(data) ? { topic: data[2] as string, event: data[3] as string } : data
        messages = [{ time: new Date().toLocaleTimeString(), topic: msg.topic ?? '', event: msg.event ?? '' }, ...messages.slice(0, 49)]
        if (msg.event === 'postgres_changes') todoCount++
      } catch {}
    }

    return () => { ws.close() }
  })
</script>

<div>
  <div class="flex items-center justify-between mb-lg">
    <h2 style="margin: 0;">Realtime Inspector</h2>
    <span class={wsStatus === 'connected' ? 'chip' : 'chip chip-muted'} style="font-size: 13px; padding: 6px 16px;">
      {wsStatus === 'connected' ? '● Connected' : '○ Disconnected'}
    </span>
  </div>

  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--space-md); margin-bottom: var(--space-lg);">
    <div class="card" style="text-align: center;">
      <div class="label" style="margin-bottom: var(--space-sm);">Status</div>
      <div style="font-family: var(--font-mono); font-size: 24px; color: {wsStatus === 'connected' ? 'var(--lichen)' : 'var(--text-muted)'};">
        {wsStatus}
      </div>
    </div>
    <div class="card" style="text-align: center;">
      <div class="label" style="margin-bottom: var(--space-sm);">Messages Received</div>
      <div style="font-family: var(--font-mono); font-size: 24px; color: var(--lichen);">{messageCount}</div>
    </div>
    <div class="card" style="text-align: center;">
      <div class="label" style="margin-bottom: var(--space-sm);">Todo Events</div>
      <div style="font-family: var(--font-mono); font-size: 24px; color: var(--lichen);">{todoCount}</div>
    </div>
    <div class="card" style="text-align: center;">
      <div class="label" style="margin-bottom: var(--space-sm);">Endpoint</div>
      <div style="font-family: var(--font-mono); font-size: 13px; color: var(--text-secondary);">
        /realtime/v1/websocket
      </div>
    </div>
  </div>

  {#if subscriptions.length > 0}
    <div class="card mb-md">
      <div class="label mb-sm">Subscriptions</div>
      {#each subscriptions as sub}
        <span class="chip" style="margin-right: 4px;">{sub}</span>
      {/each}
    </div>
  {/if}

  <div class="card">
    <div class="label mb-sm">Recent Messages</div>
    {#if messages.length === 0}
      <p style="color: var(--text-muted); padding: var(--space-lg); text-align: center;">No messages received yet</p>
    {:else}
      <div style="max-height: 400px; overflow-y: auto;">
        {#each messages as msg}
          <div style="display: flex; gap: var(--space-md); padding: 6px 0; border-bottom: 1px solid var(--border); font-family: var(--font-mono); font-size: 12px;">
            <span style="color: var(--text-muted); width: 80px;">{msg.time}</span>
            <span style="color: var(--lichen); min-width: 100px;">{msg.event}</span>
            <span style="color: var(--text-secondary);">{msg.topic}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
