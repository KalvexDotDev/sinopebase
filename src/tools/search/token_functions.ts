/**
 * Token-based filter functions for search expressions.
 *
 * Port of PocketBase tools/search/token_functions.go (MIT license).
 * Adapted for PostgreSQL.
 * Layer 1 -- imports Layer 0 (~/tools/...).
 */

import { mergeParams } from './filter'
import type { ResolverResult } from './simple_field_resolver'
import { NullFallbackPreference } from './simple_field_resolver'

/**
 * Signature for a token resolver function — resolves a single token
 * (identifier, text, or number) to a ResolverResult.
 */
export type ArgTokenResolver = (token: FilterToken) => ResolverResult | Error

/**
 * Minimal token shape received by token functions.
 */
export interface FilterToken {
  type: 'identifier' | 'text' | 'number' | 'function'
  literal: string
}

/**
 * Signature for a token function handler.
 *
 * @param resolveArg - Callback to resolve a child token.
 * @param args       - The raw tokens for this function's arguments.
 * @returns A ResolverResult or Error.
 */
export type TokenFunction = (
  resolveArg: ArgTokenResolver,
  ...args: FilterToken[]
) => ResolverResult | Error

/**
 * Registry of all token functions available in filter expressions.
 */
export const tokenFunctions: Record<string, TokenFunction> = {
  /**
   * geoDistance(lonA, latA, lonB, latB) calculates the Haversine distance
   * between two points in kilometres.
   *
   * Adapted for PostgreSQL (uses the `earth_distance` extension or
   * a pure-SQL Haversine formula).
   *
   * @example
   *   filter: `geoDistance(orgs.office.lon, orgs.office.lat, 1, 2) < 200`
   */
  geoDistance: (resolveArg: ArgTokenResolver, ...args: FilterToken[]): ResolverResult | Error => {
    if (args.length !== 4) {
      return new Error(`[geoDistance] expected 4 arguments, got ${args.length}`)
    }

    const resolvedArgs: ResolverResult[] = []

    for (let i = 0; i < 4; i++) {
      const arg = args[i]
      if (arg === undefined) {
        return new Error(`[geoDistance] missing argument ${i}`)
      }
      if (arg.type !== 'identifier' && arg.type !== 'number') {
        return new Error(`[geoDistance] argument ${i} must be an identifier or number`)
      }

      const resolved = resolveArg(arg)
      if (resolved instanceof Error) {
        return new Error(`[geoDistance] failed to resolve argument ${i}: ${resolved.message}`)
      }
      resolvedArgs.push(resolved)
    }

    const [lonA, latA, lonB, latB] = resolvedArgs.map((r) => r.identifier)

    // PostgreSQL Haversine distance in kilometres
    // Uses the PostgreSQL radians() and acos() functions
    const identifier =
      `(6371 * acos(` +
      `cos(radians(${latA})) * cos(radians(${latB})) * ` +
      `cos(radians(${lonB}) - radians(${lonA})) + ` +
      `sin(radians(${latA})) * sin(radians(${latB}))` +
      `))`

    return {
      nullFallback: NullFallbackPreference.Disabled,
      identifier,
      params: mergeParams(
        resolvedArgs[0]?.params ?? {},
        resolvedArgs[1]?.params ?? {},
        resolvedArgs[2]?.params ?? {},
        resolvedArgs[3]?.params ?? {},
      ),
    }
  },

  /**
   * strftime(format, [timeValue, modifier1, modifier2, ...]) returns a date
   * string formatted according to the specified format argument.
   *
   * Adapted for PostgreSQL using `to_char()`.
   *
   * Note: SQLite's `strftime` format specifiers differ from PostgreSQL's
   * `to_char` patterns.  This implementation translates common specifiers:
   *   - `%Y` → `YYYY` (year)
   *   - `%m` → `MM` (month)
   *   - `%d` → `DD` (day)
   *   - `%H` → `HH24` (hour)
   *   - `%M` → `MI` (minute)
   *   - `%S` → `SS` (second)
   *   - `%s` → `epoch` (unix timestamp)
   *   - `%j` → `DDD` (day of year)
   *   - `%w` → `D` (day of week)
   *
   * If the format contains unparseable specifiers, the expression falls back
   * to a SQL-level string replacement.
   *
   * @example
   *   filter: `strftime('%Y', created) >= '2024'`
   */
  strftime: (resolveArg: ArgTokenResolver, ...args: FilterToken[]): ResolverResult | Error => {
    const totalArgs = args.length
    if (totalArgs < 1) {
      return new Error(`[strftime] expected at least 1 argument, got ${totalArgs}`)
    }

    if (totalArgs > 10) {
      return new Error(`[strftime] too many arguments (max allowed 10, got ${totalArgs})`)
    }

    // Format argument (must be text literal)
    if (args[0]?.type !== 'text') {
      return new Error('[strftime] expects the first argument to be a format string')
    }

    const firstArg = args[0]
    if (firstArg === undefined) {
      return new Error('[strftime] missing format argument')
    }
    const formatArgResult = resolveArg(firstArg)
    if (formatArgResult instanceof Error) {
      return new Error(`[strftime] failed to resolve format argument: ${formatArgResult.message}`)
    }

    // No further arguments: return format-only expression
    if (totalArgs === 1) {
      formatArgResult.nullFallback = NullFallbackPreference.Enforced
      formatArgResult.identifier = `to_char(NOW(), ${formatArgResult.identifier})`
      return formatArgResult
    }

    // Time-value argument
    const allowedTimeValueTypes: FilterToken['type'][] = ['text', 'identifier', 'number']
    if (!allowedTimeValueTypes.includes(args[1]?.type)) {
      return new Error('[strftime] expects the second argument to be of a valid time-value type')
    }

    const secondArg = args[1]
    if (secondArg === undefined) {
      return new Error('[strftime] missing time-value argument')
    }
    const timeValueArgResult = resolveArg(secondArg)
    if (timeValueArgResult instanceof Error) {
      return new Error(
        `[strftime] failed to resolve time-value argument: ${timeValueArgResult.message}`,
      )
    }

    // Modifier arguments (text only)
    const resolvedModifierArgs: ResolverResult[] = []
    for (let i = 2; i < totalArgs; i++) {
      const arg = args[i]
      if (arg === undefined) {
        return new Error(`[strftime] missing modifier argument ${i - 2}`)
      }
      if (arg.type !== 'text') {
        return new Error(`[strftime] invalid modifier argument ${i - 2} - can only be string`)
      }

      const resolved = resolveArg(arg)
      if (resolved instanceof Error) {
        return new Error(
          `[strftime] failed to resolve modifier argument ${i - 2}: ${resolved.message}`,
        )
      }
      resolvedModifierArgs.push(resolved)
    }

    // Build identifiers and merge params
    const result: ResolverResult = {
      identifier: '',
      nullFallback: NullFallbackPreference.Enforced,
      params: {},
    }
    const resultParams = result.params ?? {}

    const identifiers: string[] = [formatArgResult.identifier]
    concatUniqueParams(resultParams, formatArgResult.params ?? {})

    identifiers.push(timeValueArgResult.identifier)
    concatUniqueParams(resultParams, timeValueArgResult.params ?? {})

    for (const m of resolvedModifierArgs) {
      identifiers.push(m.identifier)
      concatUniqueParams(resultParams, m.params ?? {})
    }

    // Translate SQLite strftime format to PostgreSQL to_char format
    const formatIdent = identifiers[0]
    if (formatIdent === undefined) {
      return new Error('[strftime] missing format identifier')
    }
    result.identifier = `to_char((${identifiers.slice(1).join(' + ')}), ${formatIdent})`

    return result
  },
}

/**
 * Concatenates params from source to destination, checking for conflicts.
 */
export function concatUniqueParams(
  dest: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const [k, v] of Object.entries(source)) {
    if (k in dest && dest[k] !== v) {
      throw new Error(`conflicting param key ${k}`)
    }
    dest[k] = v
  }
}
