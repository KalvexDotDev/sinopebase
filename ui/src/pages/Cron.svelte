<script lang="ts">
  import { listCronJobs, runCronJob } from '../lib/api'
  import Button from '../components/Button.svelte'

  let jobs = $state<Array<{ id: string; label?: string; schedule?: string; running?: boolean; lastRun?: string }>>([])
  let loading = $state(true)
  let running = $state('')
  let msg = $state('')

  async function load() {
    const r = await listCronJobs()
    if (r.data) jobs = Array.isArray(r.data) ? r.data : []
    loading = false
  }

  async function run(jobId: string) {
    running = jobId; msg = ''
    const r = await runCronJob(jobId)
    if (r.error) msg = r.error.message
    else { msg = `Job "${jobId}" triggered.`; load() }
    running = ''
  }

  $effect(() => { load() })
</script>

<div>
  <h2 style="margin: 0 0 var(--space-lg) 0;">Cron Jobs</h2>

  {#if msg}<div class="toast toast-success" style="margin-bottom: var(--space-md);">{msg}</div>{/if}

  {#if loading}
    <div class="card" style="padding: var(--space-lg);">{#each Array(3) as _}<div class="skeleton" style="height: 36px; margin-bottom: 6px;"></div>{/each}</div>
  {:else if jobs.length === 0}
    <div class="card" style="text-align: center; padding: var(--space-xl);">
      <p style="color: var(--text-secondary);">No cron jobs registered.</p>
      <p style="color: var(--text-muted); font-size: 13px;">Register cron jobs in your Sinopebase config or plugin.</p>
    </div>
  {:else}
    <div class="table-wrap">
      <table>
        <thead><tr><th>ID</th><th>Label</th><th>Schedule</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {#each jobs as job (job.id)}
            <tr>
              <td><code>{job.id}</code></td>
              <td>{job.label || '—'}</td>
              <td><code style="font-size: 12px;">{job.schedule || '—'}</code></td>
              <td>{job.running ? <span class="chip" style="font-size: 10px;">● Running</span> : <span class="chip chip-muted" style="font-size: 10px;">Idle</span>}</td>
              <td>
                <Button variant="ghost" size="sm" disabled={running === job.id}
                  onclick={() => run(job.id)}>
                  {running === job.id ? '…' : 'Run Now'}
                </Button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p style="margin-top: var(--space-md); color: var(--text-muted); font-size: 12px;">
      Cron jobs are scheduled tasks. Click "Run Now" to trigger execution immediately.
    </p>
  {/if}
</div>
