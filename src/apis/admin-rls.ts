/**
 * Admin RLS API — POST /api/admin/rls/enable
 *
 * Enables Row-Level Security on a specified table in the public schema.
 * Layer 4 — service_role only.
 */

import { Elysia } from 'elysia'
import type { Pool } from 'pg'

export function createAdminRlsPlugin(
  pool: Pool,
  isSuperuser: (request: Request) => boolean,
) {
  const app = new Elysia({ name: 'sinopebase-admin-rls' })

  app.post('/api/admin/rls/enable', async ({ request, body, set }) => {
    if (!isSuperuser(request)) {
      set.status = 403
      return { code: 403, message: 'Only service_role can manage RLS.' }
    }

    const { table } = (body ?? {}) as { table?: string }
    if (!table) { set.status = 400; return { code: 400, message: 'Table name required.' } }

    // Prevent SQL injection — validate table name against actual tables
    const valid = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)
    if (!valid) { set.status = 400; return { code: 400, message: 'Invalid table name.' } }

    try {
      await pool.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`)
      await pool.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`)
      return { message: `RLS enabled on ${table}.` }
    } catch (err) {
      set.status = 500
      return { code: 500, message: `Failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  })

  return app
}
