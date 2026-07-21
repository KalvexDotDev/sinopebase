// ---------------------------------------------------------------------------
// Mastra AI — MCP Tools exposing Sinopebase resources to AI agents
// ---------------------------------------------------------------------------

import type { Tool } from './agent'

/**
 * Create a set of MCP-style tools that give AI agents controlled access
 * to Sinopebase resources (database, storage, auth, edge functions).
 *
 * @param db       The IDatabase instance
 * @param fileStore The IFileStore instance (optional)
 * @param getAuth  Function returning the current auth context (optional)
 */
export function createMCPTools(
  db: any,
  fileStore?: any,
  getAuth?: () => { userId: string; email: string } | null,
): Tool[] {
  const tools: Tool[] = []

  // ---- DB Query ----
  if (db) {
    tools.push({
      id: 'db_query',
      name: 'db_query',
      description: 'Query a database table with optional filters. Read-only, max 100 rows.',
      parameters: {
        table: { type: 'string', description: 'Table name to query' },
        filters: { type: 'array', description: 'Optional filter array [{column, operator, value}]' },
        limit: { type: 'number', description: 'Max rows (default 20, max 100)' },
      },
      async execute(input) {
        const table = input.table as string
        const filters = (input.filters as any[]) || []
        const limit = Math.min((input.limit as number) || 20, 100)

        // Safety: block access to auth-related tables
        const blocked = ['user', 'session', 'account', 'verification']
        if (blocked.includes(table)) {
          return { error: `Table "${table}" is not accessible via db_query` }
        }

        try {
          const rows = await db.select(table, { filters, limit })
          return { rows, count: rows.length }
        } catch (err: any) {
          return { error: err?.message || 'Query failed' }
        }
      },
    })

    // ---- DB Schema ----
    tools.push({
      id: 'db_schema',
      name: 'db_schema',
      description: 'Get column names and types for a database table.',
      parameters: {
        table: { type: 'string', description: 'Table name' },
      },
      async execute(input) {
        const table = input.table as string
        try {
          const columns = await db.tableColumns?.(table)
          if (!columns) return { error: `Table "${table}" not found or schema unavailable` }
          return { table, columns }
        } catch (err: any) {
          return { error: err?.message || 'Schema lookup failed' }
        }
      },
    })
  }

  // ---- Storage ----
  if (fileStore) {
    tools.push({
      id: 'storage_list',
      name: 'storage_list',
      description: 'List files in a storage bucket.',
      parameters: {
        bucket: { type: 'string', description: 'Bucket name (optional)', default: '' },
        prefix: { type: 'string', description: 'Path prefix filter (optional)', default: '' },
      },
      async execute(input) {
        try {
          const bucket = (input.bucket as string) || ''
          const prefix = (input.prefix as string) || ''
          if (bucket) {
            const files = await fileStore.list(bucket, prefix || undefined)
            return { bucket, files }
          }
          const buckets = await fileStore.listBuckets?.() || []
          return { buckets }
        } catch (err: any) {
          return { error: err?.message || 'Storage list failed' }
        }
      },
    })

    tools.push({
      id: 'storage_read',
      name: 'storage_read',
      description: 'Read a file from storage (max 1MB).',
      parameters: {
        bucket: { type: 'string', description: 'Bucket name' },
        path: { type: 'string', description: 'File path' },
      },
      async execute(input) {
        try {
          const data = await fileStore.read(input.bucket, input.path)
          const text = typeof data === 'string' ? data : new TextDecoder().decode(data)
          const truncated = text.slice(0, 1_000_000) // 1MB cap
          return { content: truncated, size: text.length, truncated: text.length > 1_000_000 }
        } catch (err: any) {
          return { error: err?.message || 'Storage read failed' }
        }
      },
    })
  }

  // ---- Auth ----
  if (getAuth) {
    tools.push({
      id: 'auth_user',
      name: 'auth_user',
      description: 'Get the currently authenticated user.',
      parameters: {},
      async execute(_input) {
        const user = getAuth()
        if (!user) return { error: 'Not authenticated' }
        return { userId: user.userId, email: user.email }
      },
    })
  }

  return tools
}
