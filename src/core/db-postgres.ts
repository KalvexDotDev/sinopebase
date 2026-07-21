/**
 * PostgreSQL Database — Kysely + pg
 *
 * Real PostgreSQL backend replacing the in-memory MemoryDatabase.
 * Used when POSTGRES_URL is configured.
 */

import { Kysely, PostgresDialect, sql } from 'kysely'
import pg from 'pg'
import type { DatabaseSchema } from './db'

export interface PostgresConfig {
  postgresUrl: string
  maxPoolSize?: number
}

/**
 * PostgreSQL database wrapper with the same interface as MemoryDatabase
 * so it can be dropped in as a replacement.
 */
export class PostgresDatabase {
  private kysely: Kysely<DatabaseSchema>
  private pool: pg.Pool

  constructor(private config: PostgresConfig) {
    this.pool = new pg.Pool({
      connectionString: config.postgresUrl,
      max: config.maxPoolSize ?? 10,
    })
    const dialect = new PostgresDialect({
      pool: this.pool,
    })
    this.kysely = new Kysely<DatabaseSchema>({ dialect })
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async connect(): Promise<void> {
    await sql`SELECT 1`.execute(this.kysely)
  }

  async close(): Promise<void> {
    await this.kysely.destroy()
    await this.pool.end()
  }

  /** Expose the underlying pg.Pool for direct use (e.g. by better-auth). */
  getPool(): pg.Pool { return this.pool }

  // -----------------------------------------------------------------------
  // Table management
  // -----------------------------------------------------------------------

  async createTable(table: string): Promise<void> {
    await sql`
      CREATE TABLE IF NOT EXISTS ${sql.table(table)} (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        task TEXT NOT NULL DEFAULT '',
        is_complete BOOLEAN DEFAULT false,
        user_id TEXT
      )
    `.execute(this.kysely)
  }

  async hasTable(table: string): Promise<boolean> {
    const result = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = ${table}
      )
    `.execute(this.kysely)
    return (result.rows[0] as { exists: boolean })?.exists ?? false
  }

  async dropTable(table: string): Promise<void> {
    await sql`DROP TABLE IF EXISTS ${sql.table(table)}`.execute(this.kysely)
  }

  // -----------------------------------------------------------------------
  // CRUD — keeping the same interface as MemoryDatabase
  // -----------------------------------------------------------------------

  async insert(table: string, record: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = record['id'] ?? crypto.randomUUID()
    const data = { ...record, id }
    await this.kysely
      .insertInto(table as never)
      .values(data as never)
      .execute()
    return data
  }

  async upsert(table: string, record: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = record['id'] ?? crypto.randomUUID()
    const data = { ...record, id }
    await this.kysely
      .insertInto(table as never)
      .values(data as never)
      .onConflict((oc) => oc.column('id').doUpdateSet(data as never))
      .execute()
    return data
  }

  async select(
    table: string,
    filters: Filter[] = [],
    orderBy?: OrderBy[],
    limit?: number,
    offset?: number,
  ): Promise<Record<string, unknown>[]> {
    let query = this.kysely.selectFrom(table as never).selectAll()

    for (const filter of filters) {
      query = this.applyFilter(query as never, filter) as never
    }

    if (orderBy) {
      for (const order of orderBy) {
        query = query.orderBy(order.column as never, order.direction ?? 'asc')
      }
    }

    if (limit !== undefined) query = query.limit(limit)
    if (offset !== undefined) query = query.offset(offset)

    const result = await query.execute()
    return result as unknown as Record<string, unknown>[]
  }

  async update(
    table: string,
    filters: Filter[],
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> {
    let query = this.kysely.updateTable(table as never).set(data as never)

    for (const filter of filters) {
      query = this.applyFilter(query as never, filter) as never
    }

    const result = await query.returningAll().execute()
    return result as unknown as Record<string, unknown>[]
  }

  async delete(
    table: string,
    filters: Filter[],
  ): Promise<Record<string, unknown>[]> {
    let query = this.kysely.deleteFrom(table as never)

    for (const filter of filters) {
      query = this.applyFilter(query as never, filter) as never
    }

    const result = await query.returningAll().execute()
    return result as unknown as Record<string, unknown>[]
  }

  async count(
    table: string,
    filters: Filter[] = [],
  ): Promise<number> {
    let query = this.kysely
      .selectFrom(table as never)
      .select(sql<number>`count(*)`.as('count'))

    for (const filter of filters) {
      query = this.applyFilter(query as never, filter) as never
    }

    const result = await query.execute()
    return Number((result[0] as { count: number })?.count ?? 0)
  }

  // -----------------------------------------------------------------------
  // Filter application
  // -----------------------------------------------------------------------

  private applyFilter(
    query: ReturnType<typeof this.kysely.selectFrom>,
    filter: Filter,
  ): ReturnType<typeof this.kysely.selectFrom> {
    const col = filter.column as never

    switch (filter.operator) {
      case 'eq': return query.where(col, '=', filter.value)
      case 'neq': return query.where(col, '<>', filter.value)
      case 'gt': return query.where(col, '>', filter.value)
      case 'gte': return query.where(col, '>=', filter.value)
      case 'lt': return query.where(col, '<', filter.value)
      case 'lte': return query.where(col, '<=', filter.value)
      case 'like': return query.where(col, 'like', filter.value)
      case 'ilike': return query.where(col, 'ilike', filter.value)
      case 'is': {
        if (filter.value === null || filter.value === 'null') return query.where(col, 'is', null)
        if (filter.value === true || filter.value === 'true') return query.where(col, 'is not', null)
        return query.where(col, 'is not', null)
      }
      case 'in': {
        const values = Array.isArray(filter.value) ? filter.value : [filter.value]
        return query.where(col, 'in', values as never)
      }
      default: return query
    }
  }
}

// ---------------------------------------------------------------------------
// Types (shared with MemoryDatabase)
// ---------------------------------------------------------------------------

export interface Filter {
  column: string
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike' | 'is' | 'in'
  value: unknown
}

export interface OrderBy {
  column: string
  direction?: 'asc' | 'desc'
}
