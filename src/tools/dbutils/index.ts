/**
 * SQL index representation and parsing utilities.
 *
 * Port of PocketBase tools/dbutils/index.go (MIT license).
 * Layer 1 -- imports Layer 0 (~/tools/...).
 */

import { Tokenizer } from "~/tools/tokenizer/tokenizer";

/**
 * Parsed SQL index column metadata.
 */
export interface IndexColumn {
  /** Column identifier or expression. */
  name: string;
  /** COLLATE clause value (e.g. "NOCASE", "BINARY"). */
  collate: string;
  /** Sort direction: "ASC", "DESC", or empty. */
  sort: string;
}

/**
 * Parsed SQL CREATE INDEX expression.
 */
export interface Index {
  schemaName: string;
  indexName: string;
  tableName: string;
  where: string;
  columns: IndexColumn[];
  unique: boolean;
  optional: boolean;
}

// Regexps matching Go's indexRegex and indexColumnRegex.
// Go: (?im)create\s+(unique\s+)?\s*index\s*(if\s+not\s+exists\s+)?(\S*)\s+on\s+(\S*)\s*\(([\s\S]*)\)(?:\s*where\s+([\s\S]*))?
const INDEX_REGEX =
  /create\s+(unique\s+)?\s*index\s*(if\s+not\s+exists\s+)?(\S*)\s+on\s+(\S*)\s*\(([\s\S]*?)\)(?:\s*where\s+([\s\S]*))?$/im;

const INDEX_COLUMN_REGEX =
  /^([\s\S]+?)(?:\s+collate\s+([\w]+))?(?:\s+(asc|desc))?$/im;

/**
 * Character set used to trim index name/column tokens.
 * Matches Go's `\x60'\"[]\\r\\n\\t\\f\\v ` escaped set.
 */


/**
 * Checks if the index contains the minimum required fields to be considered valid.
 */
export function isValidIndex(idx: Index): boolean {
  return idx.indexName !== "" && idx.tableName !== "" && idx.columns.length > 0;
}

/**
 * Builds a "CREATE INDEX" SQL string from the given index parts.
 *
 * Returns an empty string if the index is not valid.
 */
export function buildIndex(idx: Index): string {
  if (!isValidIndex(idx)) return "";

  const parts: string[] = [];

  parts.push("CREATE");

  if (idx.unique) {
    parts.push("UNIQUE");
  }

  parts.push("INDEX");

  if (idx.optional) {
    parts.push("IF NOT EXISTS");
  }

  let name = "";
  if (idx.schemaName) {
    name += `"${idx.schemaName}".`;
  }
  name += `"${idx.indexName}"`;
  parts.push(name);

  parts.push("ON");
  parts.push(`"${idx.tableName}"`);

  // Columns
  const colParts: string[] = [];
  for (const col of idx.columns) {
    const trimmed = col.name.trim();
    if (!trimmed) continue;

    let colStr: string;
    if (trimmed.includes("(") || trimmed.includes(" ")) {
      // Expression
      colStr = trimmed;
    } else {
      colStr = `"${trimmed}"`;
    }

    if (col.collate) {
      colStr += ` COLLATE ${col.collate}`;
    }
    if (col.sort) {
      colStr += ` ${col.sort.toUpperCase()}`;
    }

    colParts.push(colStr);
  }

  if (idx.columns.length > 1 && colParts.length > 0) {
    parts.push(`(\n  ${colParts.join(",\n  ")}\n)`);
  } else if (colParts.length > 0) {
    parts.push(`(${colParts.join(", ")})`);
  }

  if (idx.where) {
    parts.push(`WHERE ${idx.where}`);
  }

  return parts.join(" ");
}

/**
 * Parses a "CREATE INDEX" SQL string into an Index struct.
 */
export function parseIndex(createIndexExpr: string): Index {
  const result: Index = {
    schemaName: "",
    indexName: "",
    tableName: "",
    where: "",
    columns: [],
    unique: false,
    optional: false,
  };

  const matches = INDEX_REGEX.exec(createIndexExpr);
  if (!matches || matches.length !== 7) {
    return result;
  }

  // Unique
  result.unique = matches[1]?.trim() !== undefined && matches[1].trim() !== "";

  // Optional (IF NOT EXISTS)
  result.optional = matches[2]?.trim() !== undefined && matches[2].trim() !== "";

  // SchemaName and IndexName
  const namePart = matches[3] ?? "";
  const nameTk = new Tokenizer(namePart);
  nameTk.SetSeparators(".");
  const nameParts = nameTk.ScanAll();
  if (nameParts.length >= 2) {
    result.schemaName = nameParts[0]!.trim().replace(/^[`'"\[\]]+|[`'"\[\]]+$/g, "");
    result.indexName = nameParts[1]!.trim().replace(/^[`'"\[\]]+|[`'"\[\]]+$/g, "");
  } else if (nameParts.length === 1) {
    result.indexName = nameParts[0]!.trim().replace(/^[`'"\[\]]+|[`'"\[\]]+$/g, "");
  }

  // TableName (may include schema like "schema"."table")
  const rawTableName = matches[4] ?? "";
  const tableTk = new Tokenizer(rawTableName);
  tableTk.SetSeparators(".");
  const tableParts = tableTk.ScanAll();
  if (tableParts.length >= 2) {
    result.schemaName = tableParts[0]!.trim().replace(/^[`'"\[\]]+|[`'"\[\]]+$/g, "");
    result.tableName = tableParts[1]!.trim().replace(/^[`'"\[\]]+|[`'"\[\]]+$/g, "");
  } else {
    result.tableName = rawTableName.trim().replace(/^[`'"\[\]]+|[`'"\[\]]+$/g, "");
  }

  // Columns
  const columnsStr = matches[5] ?? "";
  const columnsTk = new Tokenizer(columnsStr);
  columnsTk.SetSeparators(",");
  const rawColumns = columnsTk.ScanAll();

  for (const col of rawColumns) {
    const colMatches = INDEX_COLUMN_REGEX.exec(col);
    if (!colMatches || colMatches.length !== 4) continue;

    const trimmedName = colMatches[1]!
      .replace(/^[`'"\[\]]+|[`'"\[\]]+$/g, "")
      .trim();
    if (!trimmedName) continue;

    result.columns.push({
      name: trimmedName,
      collate: (colMatches[2] ?? "").trim(),
      sort: (colMatches[3] ?? "").toUpperCase(),
    });
  }

  // WHERE expression
  result.where = (matches[6] ?? "").trim();

  return result;
}

/**
 * Finds the first single-column unique index matching the given column name.
 *
 * @param indexes - Array of CREATE INDEX SQL strings.
 * @param column  - The column name to search for.
 * @returns The matching Index and true if found, or empty Index and false.
 */
export function findSingleColumnUniqueIndex(
  indexes: string[],
  column: string,
): { index: Index; found: boolean } {
  for (const raw of indexes) {
    const idx = parseIndex(raw);
    if (
      idx.unique &&
      idx.columns.length === 1 &&
      idx.columns[0]!.name.toLowerCase() === column.toLowerCase()
    ) {
      return { index: idx, found: true };
    }
  }
  return { index: { schemaName: "", indexName: "", tableName: "", where: "", columns: [], unique: false, optional: false }, found: false };
}

/**
 * Checks whether the specified column has a single-column unique index.
 *
 * @deprecated Use `findSingleColumnUniqueIndex(indexes, column).found` instead.
 */
export function hasSingleColumnUniqueIndex(column: string, indexes: string[]): boolean {
  return findSingleColumnUniqueIndex(indexes, column).found;
}
