// ---------------------------------------------------------------------------
// Mastra AI — MCP Tools exposing Sinopebase resources to AI agents
//
// Security:
//   Database tools support request-scoped contexts so PostgREST-style RLS
//   policies apply. When `resolveRequestContext` is provided, DB operations
//   are wrapped in `withRequestContext()` transactions that set the SQL role
//   and JWT claims before querying.
//
//   In production mode (`privilegedTools` filter), only explicitly allowed
//   tools are exposed to agents. Sensitive tools like `storage_read` must
//   be opted in by adding them to the allowed list.
// ---------------------------------------------------------------------------

import type { Filter, IDatabase } from '~/core/db-interface'
import type { IFileStore } from '~/tools/filesystem/store-interface'
import type { Tool } from './agent'
import { PostgresDatabase, type PostgresRequestContext } from '~/core/db-postgres'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MCPToolOptions {
  /**
   * Resolve the request-scoped PostgREST context (role, userId) from the
   * current AsyncLocalStorage or request. When provided and the database
   * is a PostgresDatabase, DB operations are wrapped in a transaction
   * with RLS context applied.
   */
  resolveRequestContext?: () => PostgresRequestContext | null

  /**
   * When true (default), operations that require a request context but
   * cannot obtain one return an authentication error. Set to false to
   * allow unauthenticated read-only access.
   */
  requireAuth?: boolean

  /**
   * If provided, only tools whose `id` is in this list are returned.
   * Used in production to gate which MCP tools AI agents can invoke.
   */
  privilegedTools?: string[]
}

// ---------------------------------------------------------------------------
// Table access control
// ---------------------------------------------------------------------------

const BLOCKED_TABLES = new Set([
  'user',
  'session',
  'account',
  'verification',
  '_prisma_migrations',
  'schema_migrations',
])

/** Tables the db_query tool is forbidden from querying. */
function isBlockedTable(table: string): boolean {
  if (table.startsWith('_')) return true
  if (table.startsWith('auth.')) return true
  return BLOCKED_TABLES.has(table)
}

// ---------------------------------------------------------------------------
// Scoped DB helper
// ---------------------------------------------------------------------------

/**
 * Wraps a database operation in a request-scoped RLS context when the
 * database supports it and a context is available.
 *
 * When `requireAuth` is true and no context is resolvable, returns an
 * auth error instead of running the operation.
 */
async function withRequestDb<T>(
  db: IDatabase,
  resolveRequestContext: (() => PostgresRequestContext | null) | undefined,
  requireAuth: boolean,
  operation: (requestDb: IDatabase) => Promise<T>,
): Promise<{ result?: T; error?: string }> {
  const context = resolveRequestContext?.()

  if (db instanceof PostgresDatabase && context) {
    try {
      const result = await db.withRequestContext(context, operation)
      return { result }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return { error: msg || 'Database operation failed' }
    }
  }

  if (!context && requireAuth) {
    return { error: 'Authentication required for this operation' }
  }

  try {
    const result = await operation(db)
    return { result }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { error: msg || 'Database operation failed' }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a set of MCP-style tools that give AI agents controlled access
 * to Sinopebase resources (database, storage, auth).
 *
 * @param db       The IDatabase instance
 * @param fileStore The IFileStore instance (optional)
 * @param getAuth  Function returning the current auth context (optional)
 * @param options  MCP tool options (request-scoped context, filters)
 */
export function createMCPTools(
  db: IDatabase,
  fileStore?: IFileStore,
  getAuth?: () => { userId: string; email: string } | null,
  options?: MCPToolOptions,
): Tool[] {
  const { resolveRequestContext, requireAuth = true, privilegedTools } = options ?? {}

  const tools: Tool[] = []

  // ---- DB Query ----
  if (db) {
    tools.push({
      id: 'db_query',
      name: 'db_query',
      description: 'Query a database table with optional filters. Read-only, max 100 rows.',
      parameters: {
        table: { type: 'string', description: 'Table name to query' },
        filters: {
          type: 'array',
          description: 'Optional filter array [{column, operator, value}]',
        },
        limit: { type: 'number', description: 'Max rows (default 20, max 100)' },
      },
      async execute(input) {
        const table = input.table as string
        const filters = (input.filters as Filter[]) || []
        const limit = Math.min((input.limit as number) || 20, 100)

        // Safety: block access to auth and internal tables
        if (isBlockedTable(table)) {
          return { error: `Table "${table}" is not accessible via db_query` }
        }

        const { result, error } = await withRequestDb(
          db,
          resolveRequestContext,
          requireAuth,
          (requestDb) => requestDb.select(table, { filters, limit }),
        )
        if (error) return { error }
        return { rows: result, count: result!.length }
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

        // Schema introspection doesn't need RLS — it reads metadata tables.
        const columns = await db.tableColumns?.(table)
        if (!columns) return { error: `Table "${table}" not found or schema unavailable` }
        return { table, columns }
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
          const buckets = (await fileStore.listBuckets?.()) || []
          return { buckets }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          return { error: msg || 'Storage list failed' }
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
        // Require auth context for storage_read in strict mode
        if (requireAuth && !resolveRequestContext?.()) {
          return { error: 'Authentication required for storage_read' }
        }
        try {
          const data = await fileStore.read(input.bucket as string, input.path as string)
          const text = typeof data === 'string' ? data : new TextDecoder().decode(data)
          const truncated = text.slice(0, 1_000_000) // 1MB cap
          return { content: truncated, size: text.length, truncated: text.length > 1_000_000 }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          return { error: msg || 'Storage read failed' }
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

  // ---- Privileged tools filter ----
  // In production mode (or when privilegedTools is explicitly provided),
  // only expose tools on the allowlist. Sensitive tools like storage_read
  // must be explicitly opted in.
  if (privilegedTools && privilegedTools.length > 0) {
    return tools.filter((t) => privilegedTools.includes(t.id))
  }

  return tools
}
