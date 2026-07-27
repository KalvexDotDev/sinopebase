/**
 * Filter expression parser and SQL builder for search queries.
 *
 * Port of PocketBase tools/search/filter.go (MIT license).
 * Adapted for PostgreSQL / Kysely.
 *
 * Parses filter expressions like:
 *   `id = 'test' && status = true`
 *   `(total >= {:min} && total <= {:max})`
 *   `geoDistance(lon, lat, 1, 2) < 200`
 *
 * Layer 1 -- imports Layer 0 (~/tools/...).
 */

import { PseudorandomString } from '~/tools/security/random'
import { identifierMacros } from './identifier_macros'
import type { FieldResolver, ResolverResult } from './simple_field_resolver'
import { NullFallbackPreference } from './simple_field_resolver'
import { tokenFunctions } from './token_functions'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default maximum number of filter expressions per query. */
export const DEFAULT_FILTER_EXPR_LIMIT = 200

/** Default maximum length of a filter data string. */
export const MAX_FILTER_LENGTH = 3500

/** Cache size for parsed filter expressions. */
const FILTER_CACHE_LIMIT = 500

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class FilterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FilterError'
  }
}

export class FilterExprLimitError extends FilterError {
  constructor() {
    super('max filter expressions limit reached')
    this.name = 'FilterExprLimitError'
  }
}

// ---------------------------------------------------------------------------
// Token types
// ---------------------------------------------------------------------------

export type TokenType =
  | 'identifier'
  | 'text'
  | 'number'
  | 'function'
  | 'op'
  | 'paren_open'
  | 'paren_close'

/**
 * Supported comparison operators.
 */
export type SignOp =
  | '='
  | '!='
  | '~'
  | '!~'
  | '<'
  | '<='
  | '>'
  | '>='
  | '?='
  | '?!='
  | '?~'
  | '?!~'
  | '?<'
  | '?<='
  | '?>'
  | '?>='

export type JoinOp = 'AND' | 'OR'

// ---------------------------------------------------------------------------
// AST types
// ---------------------------------------------------------------------------

export interface FilterToken {
  type: TokenType | 'op'
  literal: string
  /** For function tokens, the argument tokens. */
  args?: FilterToken[]
}

export interface FilterExpr {
  left: FilterToken
  op: SignOp
  right: FilterToken
}

export interface FilterExprGroup {
  item: FilterExpr | FilterExprGroup | FilterExprGroup[]
  join: JoinOp
}

// ---------------------------------------------------------------------------
// FilterData - the main type
// ---------------------------------------------------------------------------

/**
 * FilterData is a filter expression string.
 *
 * The filter string can also contain `{:paramName}` placeholders that
 * will be replaced with literal values before parsing.
 *
 * @example
 * ```ts
 * const filter: FilterData = "id = null || (name = 'test' && status = true)";
 * ```
 */
export type FilterData = string

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const parsedFilterCache = new Map<string, FilterExprGroup[]>()

// ---------------------------------------------------------------------------
// Main entry points
// ---------------------------------------------------------------------------

/**
 * Builds a SQL WHERE expression from a FilterData string.
 *
 * @param filterData          - The filter expression string.
 * @param fieldResolver       - Resolver for field name → SQL identifier.
 * @param placeholderReplacements - Optional `{:param}` → value mappings.
 * @param maxExpressions      - Maximum number of expressions (default 200).
 * @returns An object with `sql` (SQL fragment) and `params` (parameter values).
 *
 * @example
 *   const result = buildFilterExpr("id = {:id}", resolver, { id: "abc" });
 *   // => { sql: `"id" = $1`, params: ["abc"] }
 */
export function buildFilterExpr(
  filterData: FilterData,
  fieldResolver: FieldResolver,
  placeholderReplacements?: Record<string, unknown>,
  maxExpressions?: number,
): { sql: string; values: unknown[] } {
  const result = buildFilterExprRaw(
    filterData,
    fieldResolver,
    placeholderReplacements,
    maxExpressions,
  )

  // Convert named params to positional
  const keys = Object.keys(result.params)
  let sql = result.sql
  const values: unknown[] = []
  let idx = 0
  for (const key of keys) {
    const placeholder = `{:${key}}`
    if (sql.includes(placeholder)) {
      sql = sql.replace(new RegExp(escapeRegex(placeholder), 'g'), `$${idx + 1}`)
      values.push(result.params[key])
      idx++
    }
  }

  return { sql, values }
}

/**
 * Builds an expression but keeps named params (for internal use).
 */
export function buildFilterExprRaw(
  filterData: FilterData,
  fieldResolver: FieldResolver,
  placeholderReplacements?: Record<string, unknown>,
  maxExpressions?: number,
): { sql: string; params: Record<string, unknown> } {
  const limit = maxExpressions ?? DEFAULT_FILTER_EXPR_LIMIT
  let raw = String(filterData)

  // Validate length
  if (raw.length > MAX_FILTER_LENGTH) {
    throw new FilterError('max filter length limit reached')
  }

  // Replace placeholder params ({:key}) with literal values
  if (placeholderReplacements) {
    for (const [key, value] of Object.entries(placeholderReplacements)) {
      let replacement: string
      if (value === null || value === undefined) {
        replacement = 'null'
      } else if (typeof value === 'boolean') {
        replacement = value ? 'true' : 'false'
      } else if (typeof value === 'number') {
        replacement = String(value)
      } else {
        // String: escape single quotes
        replacement = `'${String(value).replace(/'/g, "''")}'`
      }
      raw = raw.replace(new RegExp(`\\{:${escapeRegex(key)}\\}`, 'g'), replacement)
    }
  }

  // Check cache
  const cacheKey = `${raw}/${limit}`
  const cached = parsedFilterCache.get(cacheKey)
  let groups: FilterExprGroup[]
  if (cached) {
    groups = cached
  } else {
    // Tokenize and parse
    const tokens = tokenize(raw)
    groups = parseExprGroups(tokens, 0).groups
    if (parsedFilterCache.size < FILTER_CACHE_LIMIT) {
      parsedFilterCache.set(cacheKey, groups)
    }
  }

  return buildSQLFromGroups(groups, fieldResolver, { remain: limit })
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

/**
 * Tokenizes a filter expression string into tokens.
 */
function tokenize(input: string): FilterToken[] {
  const tokens: FilterToken[] = []
  let pos = 0

  while (pos < input.length) {
    const ch = input[pos]
    if (ch === undefined) break

    // Whitespace
    if (/[\s]/.test(ch)) {
      pos++
      continue
    }

    // Parentheses
    if (ch === '(') {
      tokens.push({ type: 'paren_open', literal: '(' })
      pos++
      continue
    }
    if (ch === ')') {
      tokens.push({ type: 'paren_close', literal: ')' })
      pos++
      continue
    }

    // Single-quoted text string
    if (ch === "'") {
      pos++ // skip opening quote
      let value = ''
      while (pos < input.length) {
        if (input[pos] === "'") {
          // Check for escaped quote ('')
          if (pos + 1 < input.length && input[pos + 1] === "'") {
            value += "'"
            pos += 2
            continue
          }
          pos++ // skip closing quote
          break
        }
        value += input[pos]
        pos++
      }
      tokens.push({ type: 'text', literal: value })
      continue
    }

    // Multi-character operators: <=, >=, !=, ?=, ?!=, ?~, ?!~, ?<, ?<=, ?>, ?>=
    const twoCh = input.slice(pos, pos + 2)
    const threeCh = input.slice(pos, pos + 3)

    if (['?<=', '?>='].includes(threeCh)) {
      tokens.push({ type: 'op', literal: threeCh })
      pos += 3
      continue
    }
    if (['<=', '>=', '!=', '?=', '?!', '?~', '!~', '?<', '?>', '&&', '||'].includes(twoCh)) {
      tokens.push({ type: 'op', literal: twoCh })
      pos += 2
      continue
    }

    // Single-character operators: =, <, >, ~, ?
    if (['=', '<', '>', '~'].includes(ch)) {
      tokens.push({ type: 'op', literal: ch })
      pos++
      continue
    }

    // Numbers (integer or float)
    const nextCh = pos + 1 < input.length ? input[pos + 1] : undefined
    if (/\d/.test(ch) || (ch === '.' && nextCh !== undefined && /\d/.test(nextCh))) {
      const start = pos
      while (pos < input.length) {
        const digitChar = input[pos]
        if (digitChar === undefined) break
        if (!(/\d/.test(digitChar) || digitChar === '.')) break
        pos++
      }
      // Check if it's followed by an identifier char (then treat as identifier start)
      const identCheck = pos < input.length ? input[pos] : undefined
      if (identCheck !== undefined && /[a-zA-Z_]/.test(identCheck)) {
        // Rewind and treat as identifier
        pos = start
        const ident = readIdentifier(input, pos)
        pos += ident.length
        tokens.push({ type: 'identifier', literal: ident })
        continue
      }
      tokens.push({ type: 'number', literal: input.slice(start, pos) })
      continue
    }

    // Identifiers and keywords (including function calls)
    if (/[a-zA-Z_@]/.test(ch)) {
      const ident = readIdentifier(input, pos)
      pos += ident.length

      // Check if it's a function call (followed by open paren without space)
      const trimmed = input.slice(pos).trimStart()
      if (trimmed.startsWith('(')) {
        // Skip whitespace
        const wsLen = input.slice(pos).length - trimmed.length
        pos += wsLen
        // Read function arguments
        const args = readFunctionArgs(input, pos)
        pos += args.consumed
        tokens.push({ type: 'function', literal: ident, args: args.tokens })
        continue
      }

      tokens.push({ type: 'identifier', literal: ident })
      continue
    }

    // Skip unknown characters
    pos++
  }

  return tokens
}

/**
 * Reads an identifier from the input at the given position.
 * Identifier characters: alphanumeric, _, @, .
 */
function readIdentifier(input: string, pos: number): string {
  let result = ''
  while (pos < input.length) {
    const ch = input[pos]
    if (ch === undefined) break
    if (!/[a-zA-Z0-9_@.]/.test(ch)) break
    result += ch
    pos++
  }
  return result
}

/**
 * Reads function arguments enclosed in parentheses.
 * Returns the argument tokens and the number of characters consumed.
 */
function readFunctionArgs(input: string, pos: number): { tokens: FilterToken[]; consumed: number } {
  const start = pos
  if (input[pos] !== '(') {
    return { tokens: [], consumed: input.slice(pos).match(/^\s*/)?.[0]?.length ?? 0 }
  }
  pos++ // skip (

  const args: FilterToken[] = []
  let depth = 1
  let argStart = pos

  while (pos < input.length && depth > 0) {
    if (input[pos] === '(') {
      depth++
      pos++
    } else if (input[pos] === ')') {
      depth--
      if (depth === 0) {
        // Parse the argument substring
        const argStr = input.slice(argStart, pos).trim()
        if (argStr) {
          const argTokens = tokenize(argStr)
          // Each top-level comma-separated arg becomes a single token
          const splitArgs = splitArgsByComma(argTokens)
          args.push(...splitArgs)
        }
        pos++ // skip )
        break
      }
      pos++
    } else if (input[pos] === ',' && depth === 1) {
      const argStr = input.slice(argStart, pos).trim()
      if (argStr) {
        const argTokens = tokenize(argStr)
        args.push(...argTokens)
      }
      argStart = pos + 1
      pos++
    } else {
      pos++
    }
  }

  return {
    tokens: args,
    consumed: pos - start,
  }
}

/**
 * Splits tokens by top-level commas, returning one "argument" token per group.
 */
function splitArgsByComma(tokens: FilterToken[]): FilterToken[] {
  // Single token: return as-is
  if (tokens.length <= 1) return tokens

  // Look for comma operators and split
  const result: FilterToken[] = []
  for (const t of tokens) {
    if (t.type === 'op' && t.literal === ',') {
      continue
    }
    result.push(t)
  }
  return result
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parses a token stream into expression groups.
 *
 * Grammar (simplified):
 *   expression      → term ( "||" term )*
 *   term            → factor ( "&&" factor )*
 *   factor          → "(" expression ")" | comparison
 *   comparison      → operand operator operand
 *   operator        → "=" | "!=" | "<" | "<=" | ">" | ">=" | "~" | "!~"
 *                     | "?=" | "?!=" | "?~" | "?!~" | "?<" | "?<=" | "?>" | "?>="
 */
function parseExprGroups(
  tokens: FilterToken[],
  start: number,
): { groups: FilterExprGroup[]; end: number } {
  const groups: FilterExprGroup[] = []
  let pos = start
  let currentJoin: JoinOp = 'AND'

  while (pos < tokens.length) {
    const token = tokens[pos]
    if (token === undefined) break

    // Close paren: end of current group
    if (token.type === 'paren_close') {
      pos++
      break
    }

    // Handle OR/AND operators between groups
    if (token.type === 'op') {
      if (token.literal === '||') {
        currentJoin = 'OR'
        pos++
        continue
      }
      if (token.literal === '&&') {
        currentJoin = 'AND'
        pos++
        continue
      }
    }

    // Parse sub-expression or parenthesized group
    let item: FilterExpr | FilterExprGroup | FilterExprGroup[]

    if (token.type === 'paren_open') {
      // Parenthesized sub-group
      const result = parseExprGroups(tokens, pos + 1)
      pos = result.end
      if (result.groups.length === 1) {
        const firstGroup = result.groups[0]
        if (firstGroup === undefined) continue
        item = firstGroup
        if (Array.isArray((item as FilterExprGroup).item)) {
          item = (item as FilterExprGroup).item
        } else if (!('left' in (item as FilterExprGroup).item)) {
          item = (item as FilterExprGroup).item
        }
        // Keep as single group if it has an item
        if ('item' in item) {
          groups.push({ item: (item as FilterExprGroup).item, join: currentJoin })
          currentJoin = 'AND'
          continue
        }
      } else if (result.groups.length > 1) {
        item = result.groups
      } else {
        // Empty group -- skip
        continue
      }
    } else {
      // Parse comparison: left op right
      const left = token

      // Must be followed by an operator
      pos++
      if (pos >= tokens.length) {
        throw new FilterError(`unexpected end of expression after "${left.literal}"`)
      }

      const opToken = tokens[pos]
      if (opToken === undefined) {
        throw new FilterError('unexpected end of expression')
      }
      if (opToken.type !== 'op' || ['||', '&&'].includes(opToken.literal)) {
        throw new FilterError(`expected operator after "${left.literal}", got "${opToken.literal}"`)
      }

      const signOp = parseSignOp(opToken.literal)

      pos++
      if (pos >= tokens.length) {
        throw new FilterError(`unexpected end of expression after operator "${opToken.literal}"`)
      }

      const right = tokens[pos]
      if (right === undefined) {
        throw new FilterError('unexpected end of expression after operator')
      }
      pos++

      item = { left, op: signOp, right } satisfies FilterExpr
    }

    groups.push({ item, join: currentJoin })
    currentJoin = 'AND'
  }

  return { groups, end: pos }
}

/**
 * Converts an operator string to a SignOp.
 */
function parseSignOp(op: string): SignOp {
  const validOps: SignOp[] = [
    '=',
    '!=',
    '~',
    '!~',
    '<',
    '<=',
    '>',
    '>=',
    '?=',
    '?!=',
    '?~',
    '?!~',
    '?<',
    '?<=',
    '?>',
    '?>=',
  ]
  if (!validOps.includes(op as SignOp)) {
    throw new FilterError(`unknown operator "${op}"`)
  }
  return op as SignOp
}

// ---------------------------------------------------------------------------
// SQL Builder
// ---------------------------------------------------------------------------

/**
 * Builds SQL from expression groups.
 */
function buildSQLFromGroups(
  groups: FilterExprGroup[],
  fieldResolver: FieldResolver,
  state: { remain: number },
): { sql: string; params: Record<string, unknown> } {
  if (groups.length === 0) {
    throw new FilterError('empty filter expression')
  }

  const parts: string[] = []
  const params: Record<string, unknown> = {}

  for (const group of groups) {
    let expr: string
    let exprParams: Record<string, unknown>

    if ('left' in group.item) {
      // FilterExpr
      if (state.remain <= 0) {
        throw new FilterExprLimitError()
      }
      state.remain--
      const built = buildComparisonExpr(group.item as FilterExpr, fieldResolver)
      expr = built.sql
      exprParams = built.params
    } else if (Array.isArray(group.item)) {
      // FilterExprGroup[] (multiple sub-groups)
      if (state.remain <= 0) {
        throw new FilterExprLimitError()
      }
      const built = buildSQLFromGroups(group.item as FilterExprGroup[], fieldResolver, state)
      expr = built.sql
      exprParams = built.params
    } else {
      // Single sub-group
      const sub = group.item as FilterExprGroup
      if ('item' in sub) {
        if ('left' in sub.item) {
          if (state.remain <= 0) {
            throw new FilterExprLimitError()
          }
          state.remain--
          const built = buildComparisonExpr(sub.item as FilterExpr, fieldResolver)
          expr = built.sql
          exprParams = built.params
        } else {
          const built = buildSQLFromGroups([sub], fieldResolver, state)
          expr = built.sql
          exprParams = built.params
        }
      } else {
        expr = '1=1'
        exprParams = {}
      }
    }

    if (parts.length > 0) {
      parts.push(group.join)
    }
    parts.push(expr)
    mergeParamsInto(params, exprParams)
  }

  const firstPart = parts[0]
  if (firstPart === undefined) {
    throw new FilterError('unexpected empty parts')
  }
  return {
    sql: parts.length === 1 ? firstPart : `(${parts.join(' ')})`,
    params,
  }
}

/**
 * Builds a comparison expression (left OP right) into SQL.
 */
function buildComparisonExpr(
  expr: FilterExpr,
  fieldResolver: FieldResolver,
): { sql: string; params: Record<string, unknown> } {
  const leftResult = resolveToken(expr.left, fieldResolver)
  const rightResult = resolveToken(expr.right, fieldResolver)

  if (leftResult instanceof Error) {
    throw new FilterError(`invalid left operand "${expr.left.literal}" - ${leftResult.message}`)
  }
  if (rightResult instanceof Error) {
    throw new FilterError(`invalid right operand "${expr.right.literal}" - ${rightResult.message}`)
  }

  return buildResolversExpr(leftResult, expr.op, rightResult)
}

/**
 * Combines two resolved operands with an operator into SQL.
 */
function buildResolversExpr(
  left: ResolverResult,
  op: SignOp,
  right: ResolverResult,
): { sql: string; params: Record<string, unknown> } {
  const params = mergeParams(left.params ?? {}, right.params ?? {})

  let sql: string

  switch (op) {
    case '=':
    case '?=': {
      const built = resolveEqualExpr(true, left, right, params)
      sql = built.sql
      break
    }
    case '!=':
    case '?!=': {
      const built = resolveEqualExpr(false, left, right, params)
      sql = built.sql
      break
    }
    case '~':
    case '?~': {
      if (Object.keys(right.params ?? {}).length === 0) {
        // Right side is a column - wrap with % for contains
        sql = `${left.identifier} LIKE ('%' || ${right.identifier} || '%')`
      } else {
        sql = `${left.identifier} LIKE ${right.identifier}`
      }
      break
    }
    case '!~':
    case '?!~': {
      if (Object.keys(right.params ?? {}).length === 0) {
        sql = `${left.identifier} NOT LIKE ('%' || ${right.identifier} || '%')`
      } else {
        sql = `${left.identifier} NOT LIKE ${right.identifier}`
      }
      break
    }
    case '<':
    case '?<':
      sql = `${left.identifier} < ${right.identifier}`
      break
    case '<=':
    case '?<=':
      sql = `${left.identifier} <= ${right.identifier}`
      break
    case '>':
    case '?>':
      sql = `${left.identifier} > ${right.identifier}`
      break
    case '>=':
    case '?>=':
      sql = `${left.identifier} >= ${right.identifier}`
      break
    default:
      throw new FilterError(`unknown expression operator "${op}"`)
  }

  // Apply AfterBuild callbacks
  if (left.afterBuild) {
    sql = left.afterBuild(sql)
  }
  if (right.afterBuild) {
    sql = right.afterBuild(sql)
  }

  return { sql, params }
}

/**
 * Resolves = and != expressions with NULL/empty handling.
 */
function resolveEqualExpr(
  equal: boolean,
  left: ResolverResult,
  right: ResolverResult,
  _params: Record<string, unknown>,
): { sql: string } {
  const equalOp = equal ? '=' : '!='
  const nullEqualOp = equal ? 'IS NOT DISTINCT FROM' : 'IS DISTINCT FROM'
  const concatOp = equal ? 'OR' : 'AND'
  const nullExpr = equal ? 'IS NULL' : 'IS NOT NULL'

  // No coalesce fallback (e.g. JSON fields)
  if (
    left.nullFallback === NullFallbackPreference.Disabled ||
    right.nullFallback === NullFallbackPreference.Disabled
  ) {
    return {
      sql: `${left.identifier} ${nullEqualOp} ${right.identifier}`,
    }
  }

  const isLeftEmpty =
    isEmptyIdentifier(left) ||
    (left.nullFallback === NullFallbackPreference.Auto && hasEmptyParam(left))
  const isRightEmpty =
    isEmptyIdentifier(right) ||
    (right.nullFallback === NullFallbackPreference.Auto && hasEmptyParam(right))

  // Both empty: '' = '' (or !=)
  if (isLeftEmpty && isRightEmpty) {
    return { sql: `'' ${equalOp} ''` }
  }

  // Non-empty known value (true, false, 0, 1) -- direct compare
  if (isKnownNonEmptyIdentifier(left) || isKnownNonEmptyIdentifier(right)) {
    const leftId = isLeftEmpty ? "''" : left.identifier
    const rightId = isRightEmpty ? "''" : right.identifier
    return { sql: `${leftId} ${equalOp} ${rightId}` }
  }

  // One side is empty: handle null fallback
  if (isLeftEmpty) {
    return {
      sql: `('' ${equalOp} ${right.identifier} ${concatOp} ${right.identifier} ${nullExpr})`,
    }
  }
  if (isRightEmpty) {
    return {
      sql: `(${left.identifier} ${equalOp} '' ${concatOp} ${left.identifier} ${nullExpr})`,
    }
  }

  // Fallback: COALESCE comparison
  return {
    sql: `COALESCE(${left.identifier}, '') ${equalOp} COALESCE(${right.identifier}, '')`,
  }
}

// ---------------------------------------------------------------------------
// Token resolution helpers
// ---------------------------------------------------------------------------

/**
 * Normalized identifiers for special values.
 */
const NORMALIZED_IDENTIFIERS: Record<string, string> = {
  null: 'NULL',
  true: '1',
  false: '0',
}

/**
 * Resolves a single token to a ResolverResult.
 */
function resolveToken(token: FilterToken, fieldResolver: FieldResolver): ResolverResult | Error {
  switch (token.type) {
    case 'identifier': {
      // Check for macros
      const macroFunc = identifierMacros[token.literal]
      if (macroFunc) {
        const placeholder = `t${PseudorandomString(8)}`
        const macroValue = macroFunc()
        return {
          identifier: `{:${placeholder}}`,
          params: { [placeholder]: macroValue },
        }
      }

      // Custom field resolver
      const result = fieldResolver.resolve(token.literal)
      if (!(result instanceof Error) && result.identifier) {
        return result
      }

      // Check normalized identifiers (null, true, false)
      for (const [key, val] of Object.entries(NORMALIZED_IDENTIFIERS)) {
        if (key.toLowerCase() === token.literal.toLowerCase()) {
          return { identifier: val }
        }
      }

      return result instanceof Error
        ? result
        : new Error(`failed to resolve field "${token.literal}"`)
    }

    case 'text': {
      const placeholder = `t${PseudorandomString(8)}`
      return {
        identifier: `{:${placeholder}}`,
        params: { [placeholder]: token.literal },
      }
    }

    case 'number': {
      const placeholder = `t${PseudorandomString(8)}`
      return {
        identifier: `{:${placeholder}}`,
        params: { [placeholder]: Number(token.literal) },
      }
    }

    case 'function': {
      const fn = tokenFunctions[token.literal]
      if (!fn) {
        return new Error(`unknown function "${token.literal}"`)
      }

      const args = token.args ?? []
      const resolveArg = (
        argToken: import('./token_functions').FilterToken,
      ): ResolverResult | Error => {
        return resolveToken(argToken as FilterToken, fieldResolver)
      }

      return (fn as (...args: unknown[]) => ResolverResult | Error)(resolveArg, ...args)
    }

    default:
      return new Error(`unsupported token type "${token.type}"`)
  }
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/**
 * Merges params from source into dest.
 */
export function mergeParams(...sources: Record<string, unknown>[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const source of sources) {
    for (const [k, v] of Object.entries(source)) {
      result[k] = v
    }
  }
  return result
}

function mergeParamsInto(dest: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(source)) {
    dest[k] = v
  }
}

function isEmptyIdentifier(result: ResolverResult): boolean {
  const id = result.identifier.toLowerCase()
  return id === '' || id === 'null' || id === "''" || id === '""' || id === '``'
}

function isKnownNonEmptyIdentifier(result: ResolverResult): boolean {
  if (result.nullFallback === NullFallbackPreference.Enforced) return false

  const id = result.identifier.toLowerCase()
  if (['1', '0', 'true', 'false'].includes(id)) return true

  return (
    Object.keys(result.params ?? {}).length > 0 &&
    !hasEmptyParam(result) &&
    !isEmptyIdentifier(result)
  )
}

function hasEmptyParam(result: ResolverResult): boolean {
  for (const value of Object.values(result.params ?? {})) {
    if (value === null || value === undefined) return true
    if (typeof value === 'string' && value === '') return true
  }
  return false
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Parsed filter cache access (exported for testing).
 */
export function clearFilterCache(): void {
  parsedFilterCache.clear()
}

// ---------------------------------------------------------------------------
// Re-export parseFilterParam from existing code (extending the file)
// ---------------------------------------------------------------------------

const NON_FILTER_KEYS = new Set(['select', 'order', 'limit', 'offset', 'count', 'apikey'])

/**
 * Parse a single query-string parameter into a simple filter.
 *
 * Returns null if the key is not a filter (e.g., `select`, `order`, `or`).
 *
 * @example
 *   parseFilterParam('id', 'eq.123')  → { column: 'id', operator: 'eq', value: '123' }
 *   parseFilterParam('task', 'like.%25test%25') → { column: 'task', operator: 'like', value: '%test%' }
 */
export function parseFilterParam(
  key: string,
  rawValue: string,
): { column: string; operator: string; value: string } | null {
  if (NON_FILTER_KEYS.has(key) || key === 'or') {
    return null
  }

  const dotIndex = rawValue.indexOf('.')
  if (dotIndex === -1) return null

  const operator = rawValue.slice(0, dotIndex)
  const value = rawValue.slice(dotIndex + 1)

  if (!operator || value === undefined) return null

  return { column: key, operator, value }
}

/**
 * Parse the `or=(...)` query parameter into filter groups.
 *
 * Format: or=(column1.op1.val1,column2.op2.val2)
 */
export function parseOrFilters(
  rawValue: string,
): Array<Array<{ column: string; operator: string; value: string }>> {
  let inner = rawValue
  if (inner.startsWith('(') && inner.endsWith(')')) {
    inner = inner.slice(1, -1)
  }

  const groups: Array<Array<{ column: string; operator: string; value: string }>> = []
  const parts = splitTopLevelCommas(inner)

  const currentGroup: Array<{ column: string; operator: string; value: string }> = []
  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue

    const firstDot = trimmed.indexOf('.')
    if (firstDot === -1) continue

    const column = trimmed.slice(0, firstDot)
    const rest = trimmed.slice(firstDot + 1)

    const secondDot = rest.indexOf('.')
    if (secondDot === -1) continue

    const operator = rest.slice(0, secondDot)
    const value = rest.slice(secondDot + 1)

    currentGroup.push({ column, operator, value })
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup)
  }

  return groups
}

function splitTopLevelCommas(input: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''

  for (const char of input) {
    if (char === '(') {
      depth++
      current += char
    } else if (char === ')') {
      depth--
      current += char
    } else if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += char
    }
  }

  if (current) {
    parts.push(current)
  }

  return parts
}

/**
 * Parse an `in` filter value like `(val1,val2)` into an array of values.
 */
export function parseInValue(raw: string): string[] {
  const inner = raw.startsWith('(') && raw.endsWith(')') ? raw.slice(1, -1) : raw
  return inner
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
}
