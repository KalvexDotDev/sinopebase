import { Elysia } from 'elysia'
import type { Pool } from 'pg'

async function loadCronJobs(pool: Pool) {
  try {
    const { rows } = await pool.query('SELECT * FROM _crons ORDER BY id')
    return rows.map((r: any) => ({ id: r.id, label: r.label || '', schedule: r.schedule || '', handler: r.handler || '', lastRun: r.last_run?.toISOString?.() ?? null }))
  } catch { return [] }
}

export function createCronCrudPlugin(pool: Pool, isSuperuser: (r: Request) => boolean) {
  const app = new Elysia({ name: 'sinopebase-cron-crud' })

  // Ensure table exists
  pool.query('CREATE TABLE IF NOT EXISTS _crons (id TEXT PRIMARY KEY, label TEXT DEFAULT \'\', schedule TEXT DEFAULT \'\', handler TEXT DEFAULT \'\')').catch(() => {})

  app.get('/api/crons', async ({ request, set }) => {
    if (!isSuperuser(request)) { set.status = 403; return { code: 403, message: 'Unauthorized' } }
    return await loadCronJobs(pool)
  })

  app.post('/api/crons', async ({ request, body, set }) => {
    if (!isSuperuser(request)) { set.status = 403; return { code: 403, message: 'Unauthorized' } }
    const { id, label, schedule, handler } = (body ?? {}) as any
    if (!id) { set.status = 400; return { code: 400, message: 'id required' } }
    await pool.query('INSERT INTO _crons (id, label, schedule, handler) VALUES ($1,$2,$3,$4)', [id, label || '', schedule || '', handler || '']).catch(() => set.status = 409)
    return { message: `Created "${id}".` }
  })

  app.patch('/api/crons/:id', async ({ request, params, body, set }) => {
    if (!isSuperuser(request)) { set.status = 403; return { code: 403, message: 'Unauthorized' } }
    const { label, schedule, handler } = (body ?? {}) as any
    const sets: string[] = []; const vals: any[] = []; let i = 1
    if (label !== undefined) { sets.push(`label = $${i++}`); vals.push(label) }
    if (schedule !== undefined) { sets.push(`schedule = $${i++}`); vals.push(schedule) }
    if (handler !== undefined) { sets.push(`handler = $${i++}`); vals.push(handler) }
    if (sets.length > 0) await pool.query(`UPDATE _crons SET ${sets.join(', ')} WHERE id = $${i}`, [...vals, params.id])
    return { message: `Updated "${params.id}".` }
  })

  app.delete('/api/crons/:id', async ({ request, params, set }) => {
    if (!isSuperuser(request)) { set.status = 403; return { code: 403, message: 'Unauthorized' } }
    await pool.query('DELETE FROM _crons WHERE id = $1', [params.id])
    return { message: `Deleted "${params.id}".` }
  })

  app.post('/api/crons/:id/run', async ({ request, params, set }) => {
    if (!isSuperuser(request)) { set.status = 403; return { code: 403, message: 'Unauthorized' } }
    const { rows } = await pool.query('SELECT handler FROM _crons WHERE id = $1', [params.id])
    const handler = (rows[0] as any)?.handler || ''
    if (!handler) return { message: 'No handler configured.' }
    try {
      if (handler.startsWith('fn:')) {
        const fnName = handler.slice(3)
        const origin = request.headers.get('host') || '127.0.0.1:8090'
        const protocol = request.headers.get('x-forwarded-proto') || 'http'
        const key = process.env.SINOPEBASE_SERVICE_ROLE_KEY || ''
        const res = await fetch(`${protocol}://${origin}/api/functions/v1/${fnName}`, {
          method: 'POST', headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ trigger: 'cron', job: params.id }),
        })
        const out = await res.text()
        await pool.query('UPDATE _crons SET last_run = now() WHERE id = $1', [params.id])
        return { message: `Ran fn:${fnName}.`, output: out.slice(0, 500) }
      } else if (handler.startsWith('http')) {
        const res = await fetch(handler)
        const out = await res.text()
        await pool.query('UPDATE _crons SET last_run = now() WHERE id = $1', [params.id])
        return { message: `Fetched ${handler}.`, output: out.slice(0, 500) }
      }
      return { message: `Unknown handler: ${handler}` }
    } catch (e: any) { return { message: `Error: ${e.message}` } }
  })

  return app
}
