/**
 * Admin DDL API — POST /api/admin/tables
 *
 * Creates a new table in the public schema. service_role only.
 */

import { Elysia } from 'elysia'
import type { Pool } from 'pg'

interface CreateTableBody {
  name: string
  columns: ColumnInput[]
}

interface ColumnInput {
  name: string
  type: string
  nullable: boolean
  primary?: boolean
  default?: string | null
}

const COLUMN_TYPES = new Set([
  'text',
  'varchar',
  'integer',
  'bigint',
  'real',
  'double precision',
  'boolean',
  'timestamp with time zone',
  'date',
  'jsonb',
  'uuid',
])
const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/
const SAFE_DEFAULT =
  /^(?:-?\d+(?:\.\d+)?|true|false|null|now\(\)|gen_random_uuid\(\)|current_timestamp|'(?:[^']|'')*')$/i

function validColumnCount(columns: unknown): columns is ColumnInput[] {
  return Array.isArray(columns) && columns.length > 0 && columns.length <= 100
}

function validColumnName(col: ColumnInput | null, names: Set<string>): boolean {
  return !!col && typeof col.name === 'string' && IDENTIFIER.test(col.name) && !names.has(col.name)
}

function validColumnType(col: ColumnInput): boolean {
  return typeof col.type === 'string' && COLUMN_TYPES.has(col.type.toLowerCase())
}

function validColumnDefault(col: ColumnInput): boolean {
  return (
    col.default == null ||
    (typeof col.default === 'string' && SAFE_DEFAULT.test(col.default.trim()))
  )
}

function validateColumns(columns: ColumnInput[]): string | null {
  const names = new Set<string>()
  let primaryKeys = 0
  for (const col of columns) {
    if (!validColumnName(col, names)) return 'Column names must be unique SQL identifiers.'
    if (!validColumnType(col)) return 'Unsupported column type.'
    if (!validColumnDefault(col)) return 'Unsupported column default.'
    primaryKeys += Number(Boolean(col.primary))
    names.add(col.name)
  }
  return primaryKeys > 1 ? 'Only one primary key column is supported.' : null
}

function validateCreateTable(body: unknown): string | null {
  const { name, columns } = (body ?? {}) as Partial<CreateTableBody>
  if (!name || !IDENTIFIER.test(name))
    return 'Invalid table name. Use letters, numbers, underscores.'
  if (!validColumnCount(columns)) return 'Specify 1 to 100 columns.'
  return validateColumns(columns)
}

export function createAdminDdlPlugin(pool: Pool, isSuperuser: (request: Request) => boolean) {
  const app = new Elysia({ name: 'sinopebase-admin-ddl' })

  app.post(
    '/api/admin/tables',
    async ({ request, body, set }) => {
      if (!isSuperuser(request)) {
        set.status = 403
        return { code: 403, message: 'Only service_role can create tables.' }
      }

      const issue = validateCreateTable(body)
      if (issue) {
        set.status = 400
        return { code: 400, message: issue }
      }
      const { name, columns } = body as CreateTableBody

      const colDefs = columns.map((col) => {
        const parts = [`"${col.name}"`, col.type.toUpperCase()]
        if (!col.nullable) parts.push('NOT NULL')
        if (col.primary) parts.push('PRIMARY KEY')
        if (col.default) parts.push(`DEFAULT ${col.default.trim()}`)
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
    },
    {
      detail: {
        tags: ['Admin'],
        summary: 'Create a new table',
        description:
          'Creates a table in the public schema with the specified columns, types, and constraints.',
      },
    },
  )

  app.delete(
    '/api/admin/tables/:name',
    async ({ request, params, set }) => {
      if (!isSuperuser(request)) {
        set.status = 403
        return { code: 403, message: 'Only service_role can drop tables.' }
      }

      const { name } = params as { name: string }
      if (!name || !IDENTIFIER.test(name)) {
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
    },
    {
      detail: {
        tags: ['Admin'],
        summary: 'Drop a table',
        description:
          'Permanently deletes a table and all its data from the public schema. Requires type-name confirmation in the UI.',
      },
    },
  )

  return app
}
