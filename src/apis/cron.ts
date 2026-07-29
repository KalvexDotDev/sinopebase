/**
 * Cron API — /api/crons
 *
 * Port of PocketBase's apis/cron.go.
 * Superuser-only endpoints for listing and running cron jobs.
 * Layer 4 — imports from ~/tools/*.
 */

import { Elysia } from 'elysia'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CronJobDescriptor {
  /** Unique identifier for the cron job. */
  id: string
  /** Human-readable label. */
  label?: string
  /** Cron schedule expression. */
  schedule?: string
  /** Whether the job is currently running. */
  running?: boolean
  /** Last run timestamp. */
  lastRun?: string
}

export interface CronManager {
  /** List all registered cron jobs. */
  listJobs(): CronJobDescriptor[]
  /** Run a specific cron job by id (fire-and-forget). */
  runJob(jobId: string): boolean
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * Create an Elysia plugin that registers /api/crons endpoints.
 *
 * Both endpoints require superuser authentication.
 */
export function createCronPlugin(cronManager: CronManager, isSuperuser: (request: Request) => boolean) {
  const app = new Elysia({ name: 'sinopebase-cron' })

  // ── GET /api/crons — List cron jobs ──
  app.get('/api/crons', async ({ request, set }) => {
    if (!isSuperuser(request)) {
      set.status = 403
      return { code: 403, message: 'Only superusers can view cron jobs.' }
    }

    const jobs = cronManager.listJobs()
    return jobs
  })

  // ── POST /api/crons/:id — Run a cron job ──
  app.post('/api/crons/:id', async ({ request, params, set }) => {
    if (!isSuperuser(request)) {
      set.status = 403
      return { code: 403, message: 'Only superusers can run cron jobs.' }
    }

    const jobId = params.id as string

    const started = cronManager.runJob(jobId)
    if (!started) {
      set.status = 404
      return { code: 404, message: 'Missing or invalid cron job.' }
    }

    set.status = 204
    return undefined
  })

  return app
}
