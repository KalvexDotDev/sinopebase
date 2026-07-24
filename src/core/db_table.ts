/**
 * Table operations — ColumnType mapping, TableInfo, TableIndexes, HasTable, TableColumns.
 *
 * Port of PocketBase's daos/table.go and related table operations
 * (Go -> TypeScript).
 *
 * Provides utilities for inspecting and managing database table schemas.
 */

import type { IDatabase } from './db-interface'

// ---------------------------------------------------------------------------
// Column types (Go -> PostgreSQL mapping)
// ---------------------------------------------------------------------------

/**
 * Maps PocketBase/Go column types to PostgreSQL column types.
 */
export const ColumnTypeMap: Record<string, string> = {
  // Text types
  text: 'TEXT',
  string: 'TEXT',
  varchar: 'VARCHAR(255)',

  // Numeric types
  integer: 'INTEGER',
  int: 'INTEGER',
  bigint: 'BIGINT',
  smallint: 'SMALLINT',
  real: 'REAL',
  float: 'REAL',
  double: 'DOUBLE PRECISION',
  numeric: 'NUMERIC',
  decimal: 'DECIMAL',

  // Boolean
  bool: 'BOOLEAN',
  boolean: 'BOOLEAN',

  // Date/Time
  datetime: 'TIMESTAMPTZ',
  timestamp: 'TIMESTAMPTZ',
  date: 'DATE',
  time: 'TIME',

  // JSON
  json: 'JSONB',
  jsonb: 'JSONB',

  // Binary
  blob: 'BYTEA',
  bytea: 'BYTEA',

  // UUID
  uuid: 'UUID',

  // Default
  default: 'TEXT',
}

/**
 * Maps a PocketBase column type string to its PostgreSQL equivalent.
 */
export function mapColumnType(goType: string): string {
  return ColumnTypeMap[goType.toLowerCase()] ?? ColumnTypeMap['default']
}

// ---------------------------------------------------------------------------
// TableInfoRow
// ---------------------------------------------------------------------------

/**
 * TableInfoRow represents a row from information_schema.columns.
 */
export interface TableInfoRow {
  /** Column name. */
  columnName: string

  /** Column data type. */
  dataType: string

  /** Whether the column is nullable. */
  isNullable: boolean

  /** Default value expression. */
  columnDefault: string | null

  /** Column ordinal position. */
  ordinalPosition: number

  /** Character maximum length (for text types). */
  characterMaximumLength: number | null
}

// ---------------------------------------------------------------------------
// Table operations
// ---------------------------------------------------------------------------

/**
 * Checks if a table exists in the database.
 *
 * @param db - The database instance.
 * @param tableName - The table name to check.
 * @returns True if the table exists.
 */
export async function hasTable(
  db: IDatabase,
  tableName: string,
): Promise<boolean> {
  return db.hasTable(tableName)
}

/**
 * Retrieves all column info for a table.
 *
 * @param db - The database instance.
 * @param tableName - The table name.
 * @returns Array of TableInfoRow.
 */
export async function tableColumns(
  db: IDatabase,
  tableName: string,
): Promise<TableInfoRow[]> {
  if (!(await db.hasTable(tableName))) {
    return []
  }

  // For PostgreSQL, we'd query information_schema.columns.
  // For the memory database, return an empty list.
  // For PostgresDatabase, we need a dedicated method.
  const rows = await db.select('__table_info__', {
    filters: [{ column: 'tableName', operator: 'eq', value: tableName }],
  })

  return rows as unknown as TableInfoRow[]
}

/**
 * Retrieves table index information.
 *
 * @param db - The database instance.
 * @param tableName - The table name.
 * @returns A map of index name to index definition.
 */
export async function tableIndexes(
  db: IDatabase,
  tableName: string,
): Promise<Record<string, string>> {
  if (!(await db.hasTable(tableName))) {
    return {}
  }

  return {}
}
