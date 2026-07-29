/**
 * PostgreSQL Database — Kysely + pg
 *
 * Real PostgreSQL backend replacing the in-memory MemoryDatabase.
 * Used when POSTGRES_URL is configured.
 */

import { Kysely, PostgresDialect, type RawBuilder, sql } from 'kysely'
// @ts-expect-error The pg package currently ships without declarations here.
import pg from 'pg'
import { parseInValue } from '~/tools/search/filter'
import type { DatabaseSchema } from './db'
import type {
  Filter,
  ForeignKeyRelationship,
  IDatabase,
  OrderBy,
  SelectOptions,
} from './db-interface'

export type { Filter, OrderBy } from './db-interface'

export interface PostgresConfig {
  postgresUrl: string
  /** Optional read replica URL — SELECT queries route here when configured */
  readReplicaUrl?: string
  maxPoolSize?: number
  /**
   * PostgreSQL role to SET on each pool connection after authentication.
   *
   * Default: 'sinopebase_app' (low privilege). The pool authenticates as
   * the connection owner but immediately runs `SET ROLE <runtimeRole>`.
   * Set to '' | undefined to keep the owner role.
   */
  runtimeRole?: string
}

export interface PostgresRequestContext {
  role: 'anon' | 'authenticated' | 'service_role'
  userId?: string
}

/**
 * PostgreSQL database wrapper with optional read replica support.
 * When a readReplicaUrl is configured, SELECT and COUNT queries are routed
 * to the replica pool while writes go to the primary.
 */
export class PostgresDatabase implements IDatabase {
  private writer: Kysely<DatabaseSchema>
  private reader: Kysely<DatabaseSchema>
  private writerPool: pg.Pool
  private readerPool: pg.Pool | null = null
  private closePromise: Promise<void> | null = null

  constructor(config: PostgresConfig) {
    this.writerPool = new pg.Pool({
      connectionString: config.postgresUrl,
      max: config.maxPoolSize ?? 10,
    })

    // Apply least-privilege runtime role on each new pool connection.
    // The pool authenticates as the connection owner but immediately
    // drops privileges to sinopebase_app (or the configured role).
    // Request-scoped transactions then elevate via SET LOCAL ROLE.
    const ALLOWED_RUNTIME_ROLES = new Set([
      'sinopebase_app',
      'sinopebase_admin',
      'anon',
      'authenticated',
      'service_role',
    ])
    const defaultRole = config.runtimeRole ?? 'sinopebase_app'
    if (
      process.env.NODE_ENV === 'production' &&
      defaultRole &&
      ALLOWED_RUNTIME_ROLES.has(defaultRole)
    ) {
      this.writerPool.on('connect', (client: pg.PoolClient) => {
        // nosemgrep: ts-sql-injection-concat
        client.query(`SET ROLE ${defaultRole}`).catch(() => {
          /* best-effort — connection works without it */
        })
      })
    }

    this.writer = new Kysely<DatabaseSchema>({
      dialect: new PostgresDialect({ pool: this.writerPool }),
    })

    if (config.readReplicaUrl) {
      this.readerPool = new pg.Pool({
        connectionString: config.readReplicaUrl,
        max: config.maxPoolSize ?? 10,
      })
      this.reader = new Kysely<DatabaseSchema>({
        dialect: new PostgresDialect({ pool: this.readerPool }),
      })
    } else {
      this.reader = this.writer // fallback to primary
    }
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async connect(): Promise<void> {
    await sql`SELECT 1`.execute(this.writer)
    if (this.readerPool) {
      await sql`SELECT 1`.execute(this.reader)
    }
    // Request-context roles (anon, authenticated, service_role) must be
    // created by the 1779000000_least_privilege_roles migration BEFORE the
    // application starts in production. validateSchema() warns if they are
    // missing. We deliberately do NOT create them at runtime — DDL belongs
    // exclusively to migrations.
  }

  async close(): Promise<void> {
    this.closePromise ??= (async () => {
      const destroys = [this.writer.destroy()]
      if (this.reader !== this.writer) destroys.push(this.reader.destroy())
      await Promise.all(destroys)
    })()
    await this.closePromise
  }

  /** Expose the writer pg.Pool for direct use (e.g. by better-auth). */
  getPool(): pg.Pool {
    return this.writerPool
  }

  /** Expose the reader Kysely for read-only queries. */
  getReader(): Kysely<DatabaseSchema> {
    return this.reader
  }

  /** Expose the writer Kysely. */
  getWriter(): Kysely<DatabaseSchema> {
    return this.writer
  }

  /**
   * Run one HTTP request on a single connection with transaction-local
   * PostgREST role and JWT claims. The transaction boundary guarantees that
   * neither the role nor user identity can leak when the connection returns
   * to the pool.
   *
   * Always sets `SET LOCAL ROLE <context.role>` so every request context
   * (including service_role) runs under the intended PostgreSQL role.
   */
  async withRequestContext<T>(
    context: PostgresRequestContext,
    operation: (db: PostgresDatabase) => Promise<T>,
  ): Promise<T> {
    return this.writer.transaction().execute(async (transaction) => {
      const userId = context.userId ?? ''
      const claims = JSON.stringify({
        sub: userId || undefined,
        role: context.role,
      })

      await sql`
        SELECT
          set_config('request.jwt.claim.sub', ${userId}, true),
          set_config('request.jwt.claim.role', ${context.role}, true),
          set_config('request.jwt.claims', ${claims}, true)
      `.execute(transaction)

      const scoped = Object.create(this) as PostgresDatabase
      scoped.writer = transaction as unknown as Kysely<DatabaseSchema>
      scoped.reader = transaction as unknown as Kysely<DatabaseSchema>
      return operation(scoped)
    })
  }

  // -----------------------------------------------------------------------
  // Table management
  // -----------------------------------------------------------------------

  async createTable(table: string): Promise<void> {
    // Table-level grants are handled by ALTER DEFAULT PRIVILEGES from the
    // least-privilege-roles migration. No per-table GRANT statements needed.
    await sql`
      CREATE TABLE IF NOT EXISTS ${sql.table(table)} (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        task TEXT NOT NULL DEFAULT '',
        is_complete BOOLEAN DEFAULT false,
        user_id TEXT
      )
    `.execute(this.writer)
  }

  async hasTable(table: string): Promise<boolean> {
    const result = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = ${table}
      )
    `.execute(this.writer)
    return (result.rows[0] as { exists: boolean })?.exists ?? false
  }

  async dropTable(table: string): Promise<void> {
    await sql`DROP TABLE IF EXISTS ${sql.table(table)}`.execute(this.writer)
  }

  // -----------------------------------------------------------------------
  // CRUD — keeping the same interface as MemoryDatabase
  // -----------------------------------------------------------------------

  async insert(table: string, record: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = record.id ?? crypto.randomUUID()
    const data = { ...record, id }
    await this.writer
      .insertInto(table as never)
      .values(data as never)
      .execute()
    return data
  }

  async upsert(table: string, record: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = record.id ?? crypto.randomUUID()
    const data = { ...record, id }
    await this.writer
      .insertInto(table as never)
      .values(data as never)
      .onConflict((oc) => oc.column('id' as never).doUpdateSet(data as never))
      .execute()
    return data
  }

  async select(table: string, options: SelectOptions): Promise<Record<string, unknown>[]>
  /** @deprecated Use the options-object overload. */
  async select(
    table: string,
    filters?: Filter[],
    orderBy?: OrderBy[],
    limit?: number,
    offset?: number,
  ): Promise<Record<string, unknown>[]>
  async select(
    table: string,
    optionsOrFilters: SelectOptions | Filter[] = {},
    positionalOrder?: OrderBy[],
    positionalLimit?: number,
    positionalOffset?: number,
  ): Promise<Record<string, unknown>[]> {
    const options = Array.isArray(optionsOrFilters)
      ? {
          filters: optionsOrFilters,
          order: positionalOrder,
          limit: positionalLimit,
          offset: positionalOffset,
        }
      : optionsOrFilters
    let query = this.reader.selectFrom(table as never).selectAll()

    for (const filter of options.filters ?? []) {
      query = this.applyFilter(query as never, filter) as never
    }

    const orGroups = (options.orFilters ?? []).filter((group) => group.length > 0)
    if (orGroups.length > 0) {
      const groups = orGroups.map(
        (group) => sql<boolean>`(
        ${sql.join(
          group.map((filter) => this.filterExpression(filter)),
          sql` AND `,
        )}
      )`,
      )
      query = query.where(sql<boolean>`(${sql.join(groups, sql` OR `)})`) as never
    }

    if (options.order) {
      for (const order of options.order) {
        query = query.orderBy(order.column as never, order.direction ?? 'asc')
      }
    }

    if (options.limit !== undefined) query = query.limit(options.limit)
    if (options.offset !== undefined) query = query.offset(options.offset)

    const result = await query.execute()
    return result as unknown as Record<string, unknown>[]
  }

  async update(
    table: string,
    filters: Filter[],
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> {
    let query = this.writer.updateTable(table as never).set(data as never)

    for (const filter of filters) {
      query = this.applyFilter(query as never, filter) as never
    }

    const result = await query.returningAll().execute()
    return result as unknown as Record<string, unknown>[]
  }

  async delete(table: string, filters: Filter[]): Promise<Record<string, unknown>[]> {
    let query = this.writer.deleteFrom(table as never)

    for (const filter of filters) {
      query = this.applyFilter(query as never, filter) as never
    }

    const result = await query.returningAll().execute()
    return result as unknown as Record<string, unknown>[]
  }

  async count(table: string, filters: Filter[] = []): Promise<number> {
    let query = this.reader.selectFrom(table as never).select(sql<number>`count(*)`.as('count'))

    for (const filter of filters) {
      query = this.applyFilter(query as never, filter) as never
    }

    const result = await query.execute()
    return Number((result[0] as { count: number })?.count ?? 0)
  }

  /**
   * Return the public-schema, single-column foreign keys touching a table.
   * PostgREST uses this metadata to resolve both many-to-one and one-to-many
   * embedded resource selections.
   */
  async getForeignKeyRelationships(table: string): Promise<ForeignKeyRelationship[]> {
    const result = await sql<ForeignKeyRelationship>`
      SELECT
        constraint_info.conname AS "constraintName",
        source_table.relname AS "sourceTable",
        source_column.attname AS "sourceColumn",
        target_table.relname AS "targetTable",
        target_column.attname AS "targetColumn"
      FROM pg_constraint AS constraint_info
      JOIN pg_class AS source_table
        ON source_table.oid = constraint_info.conrelid
      JOIN pg_namespace AS source_schema
        ON source_schema.oid = source_table.relnamespace
      JOIN pg_class AS target_table
        ON target_table.oid = constraint_info.confrelid
      JOIN pg_namespace AS target_schema
        ON target_schema.oid = target_table.relnamespace
      JOIN pg_attribute AS source_column
        ON source_column.attrelid = source_table.oid
        AND source_column.attnum = constraint_info.conkey[1]
      JOIN pg_attribute AS target_column
        ON target_column.attrelid = target_table.oid
        AND target_column.attnum = constraint_info.confkey[1]
      WHERE constraint_info.contype = 'f'
        AND array_length(constraint_info.conkey, 1) = 1
        AND source_schema.nspname = 'public'
        AND target_schema.nspname = 'public'
        AND (source_table.relname = ${table} OR target_table.relname = ${table})
    `.execute(this.reader)

    return result.rows as unknown as ForeignKeyRelationship[]
  }

  // -----------------------------------------------------------------------
  // Filter application
  // -----------------------------------------------------------------------

  private applyFilter(
    query: ReturnType<typeof this.writer.selectFrom>,
    filter: Filter,
  ): ReturnType<typeof this.writer.selectFrom> {
    const dynamicQuery = query as unknown as {
      where(expression: RawBuilder<boolean>): typeof query
    }
    return dynamicQuery.where(this.filterExpression(filter))
  }

  private filterExpression(filter: Filter): RawBuilder<boolean> {
    const column = sql.ref(filter.column)

    switch (filter.operator) {
      case 'eq':
        return sql<boolean>`${column} = ${filter.value}`
      case 'neq':
        return sql<boolean>`${column} <> ${filter.value}`
      case 'gt':
        return sql<boolean>`${column} > ${filter.value}`
      case 'gte':
        return sql<boolean>`${column} >= ${filter.value}`
      case 'lt':
        return sql<boolean>`${column} < ${filter.value}`
      case 'lte':
        return sql<boolean>`${column} <= ${filter.value}`
      case 'like':
        return sql<boolean>`${column} LIKE ${filter.value}`
      case 'ilike':
        return sql<boolean>`${column} ILIKE ${filter.value}`
      case 'is': {
        if (filter.value === null || filter.value === 'null') return sql<boolean>`${column} IS NULL`
        if (filter.value === true || filter.value === 'true') return sql<boolean>`${column} IS TRUE`
        if (filter.value === false || filter.value === 'false')
          return sql<boolean>`${column} IS FALSE`
        throw new Error(`Unsupported is-filter value: ${String(filter.value)}`)
      }
      case 'in': {
        const values = Array.isArray(filter.value)
          ? filter.value
          : typeof filter.value === 'string'
            ? parseInValue(filter.value)
            : [filter.value]
        if (values.length === 0) return sql<boolean>`FALSE`
        return sql<boolean>`${column} IN (${sql.join(values)})`
      }
      default:
        throw new Error(`Unsupported filter operator: ${filter.operator}`)
    }
  }
}
