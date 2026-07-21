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
  /** Optional read replica URL — SELECT queries route here when configured */
  readReplicaUrl?: string
  maxPoolSize?: number
}

/**
 * PostgreSQL database wrapper with optional read replica support.
 * When a readReplicaUrl is configured, SELECT and COUNT queries are routed
 * to the replica pool while writes go to the primary.
 */
export class PostgresDatabase {
  private writer: Kysely<DatabaseSchema>
  private reader: Kysely<DatabaseSchema>
  private writerPool: pg.Pool
  private readerPool: pg.Pool | null = null

  constructor(private config: PostgresConfig) {
    this.writerPool = new pg.Pool({
      connectionString: config.postgresUrl,
      max: config.maxPoolSize ?? 10,
    })
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
  }

  async close(): Promise<void> {
    await this.writer.destroy()
    await this.writerPool.end()
    if (this.readerPool) {
      await this.reader.destroy()
      await this.readerPool.end()
    }
  }

  /** Expose the writer pg.Pool for direct use (e.g. by better-auth). */
  getPool(): pg.Pool { return this.writerPool }

  /** Expose the reader Kysely for read-only queries. */
  getReader(): Kysely<DatabaseSchema> { return this.reader }

  /** Expose the writer Kysely. */
  getWriter(): Kysely<DatabaseSchema> { return this.writer }

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
    const id = record['id'] ?? crypto.randomUUID()
    const data = { ...record, id }
    await this.writer
      .insertInto(table as never)
      .values(data as never)
      .execute()
    return data
  }

  async upsert(table: string, record: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = record['id'] ?? crypto.randomUUID()
    const data = { ...record, id }
    await this.writer
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
    let query = this.reader.selectFrom(table as never).selectAll()

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
    let query = this.writer.updateTable(table as never).set(data as never)

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
    let query = this.writer.deleteFrom(table as never)

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
    let query = this.reader
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
    query: ReturnType<typeof this.writer.selectFrom>,
    filter: Filter,
  ): ReturnType<typeof this.writer.selectFrom> {
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
