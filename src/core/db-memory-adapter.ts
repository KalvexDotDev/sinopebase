import type { Filter, IDatabase, SelectOptions } from './db-interface'
import { MemoryDatabase, type ParsedFilter } from './db-memory'

/** Adapts the legacy batch-oriented MemoryDatabase to the canonical contract. */
export class MemoryDatabaseAdapter implements IDatabase {
  private readonly database: MemoryDatabase

  constructor(database = new MemoryDatabase()) {
    this.database = database
  }

  getMemoryDatabase(): MemoryDatabase {
    return this.database
  }

  async createTable(table: string): Promise<void> {
    this.database.createTable(table)
  }

  async hasTable(table: string): Promise<boolean> {
    return this.database.hasTable(table)
  }

  async dropTable(table: string): Promise<void> {
    this.database.dropTable(table)
  }

  async insert(
    table: string,
    record: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const inserted = this.database.insert(table, [record])[0]
    if (!inserted) throw new Error('Memory database did not return the inserted record')
    return inserted
  }

  async upsert(
    table: string,
    record: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const upserted = this.database.upsert(table, [record])[0]
    if (!upserted) throw new Error('Memory database did not return the upserted record')
    return upserted
  }

  async select(
    table: string,
    options: SelectOptions = {},
  ): Promise<Record<string, unknown>[]> {
    return this.database.select(table, {
      filters: toParsedFilters(options.filters),
      orFilters: options.orFilters
        ?.filter((group) => group.length > 0)
        .map(toParsedFilters),
      order: options.order
        ?.map((order) => `${order.column}.${order.direction ?? 'asc'}`)
        .join(','),
      limit: options.limit,
      offset: options.offset,
    }).rows
  }

  async update(
    table: string,
    filters: Filter[],
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> {
    return this.database.update(table, toParsedFilters(filters), data)
  }

  async delete(
    table: string,
    filters: Filter[],
  ): Promise<Record<string, unknown>[]> {
    return this.database.delete(table, toParsedFilters(filters))
  }

  async count(table: string, filters: Filter[] = []): Promise<number> {
    return this.database.count(table, toParsedFilters(filters))
  }
}

function toParsedFilters(filters: Filter[] = []): ParsedFilter[] {
  return filters.map((filter) => ({ ...filter }))
}
