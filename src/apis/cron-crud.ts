import { Elysia } from 'elysia'
import type { Pool } from 'pg'

async function loadCronJobs(pool: Pool) {
  try {
    const { rows } = await pool.query('SELECT * FROM _crons ORDER BY id')
    return rows.map((r: any) => ({ id: r.id, label: r.label || '', schedule: r.schedule || '', lastRun: r.last_run?.toISOString?.() ?? null }))
  } catch { return [] }
}

export function createCronCrudPlugin(pool: Pool, isSuperuser: (r: Request) => boolean) {
  const app = new Elysia({ name: 'sinopebase-cron-crud' })

  // Ensure table exists
  pool.query('CREATE TABLE IF NOT EXISTS _crons (id TEXT PRIMARY KEY, label TEXT DEFAULT \'\', schedule TEXT DEFAULT \'\')').catch(() => {})

  app.get('/api/crons', async ({ request, set }) => {
    if (!isSuperuser(request)) { set.status = 403; return { code: 403, message: 'Unauthorized' } }
    return await loadCronJobs(pool)
  })

  app.post('/api/crons', async ({ request, body, set }) => {
    if (!isSuperuser(request)) { set.status = 403; return { code: 403, message: 'Unauthorized' } }
    const { id, label, schedule } = (body ?? {}) as any
    if (!id) { set.status = 400; return { code: 400, message: 'id required' } }
    await pool.query('INSERT INTO _crons (id, label, schedule) VALUES ($1,$2,$3)', [id, label || '', schedule || '']).catch(() => set.status = 409)
    return { message: `Created "${id}".` }
  })

  app.patch('/api/crons/:id', async ({ request, params, body, set }) => {
    if (!isSuperuser(request)) { set.status = 403; return { code: 403, message: 'Unauthorized' } }
    const { label, schedule } = (body ?? {}) as any
    const sets: string[] = []; const vals: any[] = []; let i = 1
    if (label !== undefined) { sets.push(`label = $${i++}`); vals.push(label) }
    if (schedule !== undefined) { sets.push(`schedule = $${i++}`); vals.push(schedule) }
    if (sets.length > 0) await pool.query(`UPDATE _crons SET ${sets.join(', ')} WHERE id = $${i}`, [...vals, params.id])
    return { message: `Updated "${params.id}".` }
  })

  app.delete('/api/crons/:id', async ({ request, params, set }) => {
    if (!isSuperuser(request)) { set.status = 403; return { code: 403, message: 'Unauthorized' } }
    await pool.query('DELETE FROM _crons WHERE id = $1', [params.id])
    return { message: `Deleted "${params.id}".` }
  })

  return app
}
