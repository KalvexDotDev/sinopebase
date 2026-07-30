/**
 * Admin DDL API — POST /api/admin/tables
 *
 * Creates a new table in the public schema. service_role only.
 */

import { Elysia } from 'elysia'
import type { Pool } from 'pg'

interface CreateTableBody {
  name: string
  columns: Array<{
    name: string
    type: string
    nullable: boolean
    primary?: boolean
    default?: string | null
  }>
}

export function createAdminDdlPlugin(
  pool: Pool,
  isSuperuser: (request: Request) => boolean,
) {
  const app = new Elysia({ name: 'sinopebase-admin-ddl' })

  app.post('/api/admin/tables', async ({ request, body, set }) => {
    if (!isSuperuser(request)) {
      set.status = 403
      return { code: 403, message: 'Only service_role can create tables.' }
    }

    const { name, columns } = (body ?? {}) as CreateTableBody

    if (!name || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      set.status = 400
      return { code: 400, message: 'Invalid table name. Use letters, numbers, underscores.' }
    }

    if (!columns || columns.length === 0) {
      set.status = 400
      return { code: 400, message: 'At least one column is required.' }
    }

    const colDefs = columns.map((col) => {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col.name)) {
        throw new Error(`Invalid column name: ${col.name}`)
      }
      const parts = [`"${col.name}"`, col.type.toUpperCase()]
      if (!col.nullable) parts.push('NOT NULL')
      if (col.primary) parts.push('PRIMARY KEY')
      if (col.default) parts.push(`DEFAULT ${col.default}`)
      return parts.join(' ')
    })

    try {
      await pool.query(`CREATE TABLE "${name}" (${colDefs.join(', ')})`)
      return { message: `Table "${name}" created.` }
    } catch (err) {
      set.status = 500
      return {
        code: 500,
        message: `Failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }, {
    detail: { tags: ['Admin'], summary: 'Create a new table', description: 'Creates a table in the public schema with the specified columns, types, and constraints.' },
  })

  app.delete('/api/admin/tables/:name', async ({ request, params, set }) => {
    if (!isSuperuser(request)) {
      set.status = 403
      return { code: 403, message: 'Only service_role can drop tables.' }
    }

    const { name } = params as { name: string }
    if (!name || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      set.status = 400
      return { code: 400, message: 'Invalid table name.' }
    }

    try {
      await pool.query(`DROP TABLE IF EXISTS "${name}" CASCADE`)
      return { message: `Table "${name}" dropped.` }
    } catch (err) {
      set.status = 500
      return {
        code: 500,
        message: `Failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }, {
    detail: { tags: ['Admin'], summary: 'Drop a table', description: 'Permanently deletes a table and all its data from the public schema. Requires type-name confirmation in the UI.' },
  })

  return app
}
