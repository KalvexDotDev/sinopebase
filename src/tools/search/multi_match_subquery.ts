/**
 * Multi-match subquery builder for relation field filters.
 *
 * Port of PocketBase tools/search/multi_match_subquery.go (MIT license).
 * Layer 1 -- imports Layer 0 (~/tools/...).
 */

/**
 * A single SQL JOIN clause definition.
 */
export interface JoinDef {
  tableName: string
  tableAlias: string
  on: string // SQL expression for the ON clause
}

/**
 * MultiMatchSubQuery defines a subquery for multi-value relation fields.
 *
 * When a filter references a relation field (e.g. `orgs.office.lon`) which
 * could match multiple related records, this subquery selects candidate values
 * for the filter to evaluate against.
 *
 * The subquery returns a single `multiMatchValue` column.
 */
export class MultiMatchSubQuery {
  /**
   * Alias of the target table (the outer query's table).
   */
  targetTableAlias: string

  /**
   * Name of the from table for this subquery.
   */
  fromTableName: string

  /**
   * Alias of the from table for this subquery.
   */
  fromTableAlias: string

  /**
   * Identifier expression for the value column.
   */
  valueIdentifier: string

  /**
   * JOINs needed for this subquery.
   */
  joins: JoinDef[] = []

  /**
   * Additional parameter placeholders for this subquery.
   */
  params: Record<string, unknown> = {}

  constructor(config: {
    targetTableAlias?: string
    fromTableName?: string
    fromTableAlias?: string
    valueIdentifier?: string
    joins?: JoinDef[]
    params?: Record<string, unknown>
  }) {
    this.targetTableAlias = config.targetTableAlias ?? ''
    this.fromTableName = config.fromTableName ?? ''
    this.fromTableAlias = config.fromTableAlias ?? ''
    this.valueIdentifier = config.valueIdentifier ?? ''
    this.joins = config.joins ?? []
    this.params = config.params ?? {}
  }

  /**
   * Builds the subquery SQL string.
   *
   * Returns "0=1" (always false) if required config is missing.
   *
   * @param params - Optional params map to merge into (mutated in place).
   */
  build(params?: Record<string, unknown>): string {
    if (!this.targetTableAlias || !this.fromTableName || !this.fromTableAlias) {
      return '0=1'
    }

    // Merge params into the provided map (if any)
    const target = params ?? this.params
    for (const [k, v] of Object.entries(this.params)) {
      target[k] = v
    }

    // Build JOIN clauses
    const joinClauses: string[] = []
    for (const j of this.joins) {
      let clause = `LEFT JOIN "${j.tableName}" "${j.tableAlias}"`
      if (j.on) {
        clause += ` ON ${j.on}`
      }
      joinClauses.push(clause)
    }

    const joinsStr = joinClauses.length > 0 ? ` ${joinClauses.join(' ')}` : ''

    return [
      `SELECT ${this.valueIdentifier} AS "multiMatchValue"`,
      `FROM "${this.fromTableName}" "${this.fromTableAlias}"`,
      joinsStr,
      `WHERE "${this.fromTableAlias}"."id" = "${this.targetTableAlias}"."id"`,
    ].join(' ')
  }
}
