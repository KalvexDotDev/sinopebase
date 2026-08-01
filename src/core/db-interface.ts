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
  filters?: Filter[]
  /** OR-of-AND groups: each inner group is ANDed, then the groups are ORed. */
  orFilters?: Filter[][]
  order?: OrderBy[]
  limit?: number
  offset?: number
}

/** A single-column PostgreSQL foreign-key relationship. */
export interface ForeignKeyRelationship {
  constraintName: string
  sourceTable: string
  sourceColumn: string
  targetTable: string
  targetColumn: string
}

export interface IDatabase {
  createTable(table: string): Promise<void>
  hasTable(table: string): Promise<boolean>
  dropTable(table: string): Promise<void>

  insert(table: string, record: Record<string, unknown>): Promise<Record<string, unknown>>
  upsert(table: string, record: Record<string, unknown>): Promise<Record<string, unknown>>

  select(table: string, options: SelectOptions): Promise<Record<string, unknown>[]>
  update(
    table: string,
    filters: Filter[],
    data: Record<string, unknown>,
    orFilters?: Filter[][],
  ): Promise<Record<string, unknown>[]>
  delete(
    table: string,
    filters: Filter[],
    orFilters?: Filter[][],
  ): Promise<Record<string, unknown>[]>
  count(table: string, filters?: Filter[]): Promise<number>

  /** Optional because the in-memory database has no schema metadata. */
  getForeignKeyRelationships?(table: string): Promise<ForeignKeyRelationship[]>
}

/**
 * Explicit opt-in for record-table schema mutations.
 *
 * CRUD databases do not automatically gain these methods. In particular,
 * PostgreSQL must not interpolate caller-provided column type expressions
 * into arbitrary ALTER TABLE statements.
 */
export interface DatabaseSchemaCapability {
  addColumn(table: string, column: string, columnType: string): Promise<void>
  dropColumn(table: string, column: string): Promise<void>
  renameColumn(table: string, oldName: string, newName: string): Promise<void>
}

export type SchemaDatabase = IDatabase & DatabaseSchemaCapability

export function hasDatabaseSchemaCapability(database: IDatabase): database is SchemaDatabase {
  const candidate = database as IDatabase & Partial<DatabaseSchemaCapability>
  return (
    typeof candidate.addColumn === 'function' &&
    typeof candidate.dropColumn === 'function' &&
    typeof candidate.renameColumn === 'function'
  )
}
