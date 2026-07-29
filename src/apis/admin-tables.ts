/**
 * Admin Tables API — GET /api/admin/tables
 *
 * Returns a list of all user tables in the public schema with column metadata,
 * suitable for the admin UI Table Editor.
 *
 * Layer 4 — service_role only.
 */

import { Elysia } from 'elysia'
import type { IDatabase } from '~/core/db-interface'
import { PostgresDatabase } from '~/core/db-postgres'

export interface TableColumn {
  name: string
  type: string
  nullable: boolean
  isPrimaryKey: boolean
  defaultValue: string | null
}

export interface TableInfo {
  schema: string
  name: string
  columns: TableColumn[]
  hasRLS: boolean
}

/**
 * Create an Elysia plugin that registers /api/admin/tables.
 */
export function createAdminTablesPlugin(
  db: IDatabase,
  isSuperuser: (request: Request) => boolean,
) {
  const app = new Elysia({ name: 'sinopebase-admin-tables' })

  app.get('/api/admin/tables', async ({ request, set }) => {
    if (!isSuperuser(request)) {
      set.status = 403
      return { code: 403, message: 'Only service_role can list tables.' }
    }

    try {
      if (db instanceof PostgresDatabase) {
        const pool = db.getPool()
        const result = await pool.query(`
          SELECT
            t.table_schema,
            t.table_name,
            c.column_name,
            c.data_type,
            c.is_nullable,
            c.column_default,
            CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_pk,
            CASE WHEN rls.relname IS NOT NULL THEN true ELSE false END AS has_rls
          FROM information_schema.tables t
          JOIN information_schema.columns c
            ON c.table_schema = t.table_schema AND c.table_name = t.table_name
          LEFT JOIN (
            SELECT ku.table_schema, ku.table_name, ku.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage ku
              ON ku.constraint_name = tc.constraint_name
              AND ku.table_schema = tc.table_schema
              AND ku.table_name = tc.table_name
            WHERE tc.constraint_type = 'PRIMARY KEY'
          ) pk ON pk.table_schema = c.table_schema
               AND pk.table_name = c.table_name
               AND pk.column_name = c.column_name
          LEFT JOIN pg_class rls
            ON rls.relname = t.table_name
            AND rls.relrowsecurity = true
          WHERE t.table_schema = 'public'
            AND t.table_type = 'BASE TABLE'
            AND t.table_name NOT LIKE '_%'
            AND t.table_name NOT IN ('schema_migrations', 'migrations')
          ORDER BY t.table_name, c.ordinal_position
        `)

        // Group rows into TableInfo objects
        const tableMap = new Map<string, TableInfo>()
        for (const row of result.rows) {
          const key = `${row.table_schema}.${row.table_name}`
          let table = tableMap.get(key)
          if (!table) {
            table = {
              schema: String(row.table_schema),
              name: String(row.table_name),
              columns: [],
              hasRLS: Boolean(row.has_rls),
            }
            tableMap.set(key, table)
          }
          table.columns.push({
            name: String(row.column_name),
            type: String(row.data_type),
            nullable: row.is_nullable === 'YES',
            isPrimaryKey: Boolean(row.is_pk),
            defaultValue: row.column_default ? String(row.column_default) : null,
          })
        }

        return Array.from(tableMap.values())
      }

      // For in-memory DB, return an empty list
      return []
    } catch (err) {
      set.status = 500
      return {
        code: 500,
        message: `Failed to list tables: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })

  return app
}
