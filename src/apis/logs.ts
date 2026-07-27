/**
 * Logs API — /api/logs
 *
 * Port of PocketBase's apis/logs.go.
 * Superuser-only endpoints for viewing application logs.
 * Layer 4 — imports from ~/core/*.
 */

import { Elysia } from 'elysia'
import type { IDatabase } from '~/core/db-interface'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function selectRows(
  db: IDatabase,
  table: string,
  options?: unknown,
): Promise<Record<string, unknown>[]> {
  try {
    const result: unknown = await db.select(
      table,
      (options ?? {}) as Parameters<IDatabase['select']>[1],
    )
    if (Array.isArray(result)) return result
    if (result && typeof result === 'object' && 'rows' in result) {
      const { rows } = result
      if (Array.isArray(rows)) return rows
    }
    return []
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * Create an Elysia plugin that registers /api/logs endpoints.
 *
 * All endpoints require superuser authentication.
 */
export function createLogsPlugin(db: IDatabase, isSuperuser: () => boolean) {
  const app = new Elysia()

  // ── GET /api/logs — List log entries ──
  app.get('/api/logs', async ({ query, set }) => {
    if (!isSuperuser()) {
      set.status = 403
      return { code: 403, message: 'Only superusers can view logs.' }
    }

    try {
      const q = query as Record<string, string>
      const page = Math.max(1, parseInt(q.page ?? '1', 10) || 1)
      const perPage = Math.min(
        200,
        Math.max(1, parseInt(q.perPage ?? q.per_page ?? '30', 10) || 30),
      )

      const rows = await selectRows(db, '_logs')

      const logs = rows.map((r) => ({
        id: String(r.id ?? ''),
        level: Number(r.level ?? 0),
        message: String(r.message ?? ''),
        data: (r.data as Record<string, unknown>) ?? {},
        created: String(r.created ?? ''),
        updated: String(r.updated ?? ''),
      }))

      const totalItems = logs.length
      const totalPages = Math.ceil(totalItems / perPage)
      const start = (page - 1) * perPage
      const items = logs.slice(start, start + perPage)

      return {
        page,
        perPage,
        totalItems,
        totalPages,
        items,
      }
    } catch (err) {
      set.status = 400
      return {
        code: 400,
        message: `Failed to list logs: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })

  // ── GET /api/logs/stats — Log statistics ──
  app.get('/api/logs/stats', async ({ set }) => {
    if (!isSuperuser()) {
      set.status = 403
      return { code: 403, message: 'Only superusers can view log stats.' }
    }

    try {
      const rows = await selectRows(db, '_logs')

      const stats: Record<string, number> = {}
      for (const row of rows) {
        const created = String(row.created ?? '').slice(0, 10)
        stats[created] = (stats[created] ?? 0) + 1
      }

      return Object.entries(stats).map(([date, count]) => ({ date, count }))
    } catch (err) {
      set.status = 400
      return {
        code: 400,
        message: `Failed to get log stats: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })

  // ── GET /api/logs/:id — View a log entry ──
  app.get('/api/logs/:id', async ({ params, set }) => {
    if (!isSuperuser()) {
      set.status = 403
      return { code: 403, message: 'Only superusers can view logs.' }
    }

    try {
      const logId = params.id as string
      const rows = await selectRows(db, '_logs', {
        filters: [{ column: 'id', operator: 'eq', value: logId }],
        limit: 1,
      })

      if (rows.length === 0) {
        set.status = 404
        return { code: 404, message: 'Log not found.' }
      }

      const row = rows[0]
      if (!row) {
        set.status = 404
        return { code: 404, message: 'Log not found.' }
      }
      return {
        id: String(row.id ?? ''),
        level: Number(row.level ?? 0),
        message: String(row.message ?? ''),
        data: (row.data as Record<string, unknown>) ?? {},
        created: String(row.created ?? ''),
        updated: String(row.updated ?? ''),
      }
    } catch (err) {
      set.status = 400
      return {
        code: 400,
        message: `Failed to view log: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })

  return app
}
