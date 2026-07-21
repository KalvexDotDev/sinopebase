/**
 * Shared database interface — implemented by both MemoryDatabase and PostgresDatabase.
 */

export interface Filter {
  column: string
  operator: string
  value: unknown
}

export interface OrderBy {
  column: string
  direction?: 'asc' | 'desc'
}

export interface SelectOptions {
  filters: Filter[]
  orFilters?: string[]
  order?: OrderBy[]
  limit?: number
  offset?: number
}

export interface IDatabase {
  createTable(table: string): Promise<void>
  hasTable(table: string): Promise<boolean>
  dropTable(table: string): Promise<void>

  insert(table: string, record: Record<string, unknown>): Promise<Record<string, unknown>>
  upsert(table: string, record: Record<string, unknown>): Promise<Record<string, unknown>>

  select(table: string, options: SelectOptions): Promise<Record<string, unknown>[]>
  update(table: string, filters: Filter[], data: Record<string, unknown>): Promise<Record<string, unknown>[]>
  delete(table: string, filters: Filter[]): Promise<Record<string, unknown>[]>
  count(table: string, filters?: Filter[]): Promise<number>
}
