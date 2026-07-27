import { describe, expect, it } from 'bun:test'
import { SimpleFieldResolver } from './simple_field_resolver'
import { buildSortExpr, parseSort, SORT_ASC, SORT_DESC } from './sort'

describe('parseSort', () => {
  it('parses ascending sort', () => {
    const result = parseSort('name')
    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe('name')
    expect(result[0]?.direction).toBe(SORT_ASC)
  })

  it('parses descending sort with minus prefix', () => {
    const result = parseSort('-created')
    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe('created')
    expect(result[0]?.direction).toBe(SORT_DESC)
  })

  it('parses ascending sort with plus prefix', () => {
    const result = parseSort('+position')
    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe('position')
    expect(result[0]?.direction).toBe(SORT_ASC)
  })

  it('parses multiple sort fields', () => {
    const result = parseSort('-name,+created,id')
    expect(result).toHaveLength(3)
    expect(result[0]?.name).toBe('name')
    expect(result[0]?.direction).toBe(SORT_DESC)
    expect(result[1]?.name).toBe('created')
    expect(result[1]?.direction).toBe(SORT_ASC)
    expect(result[2]?.name).toBe('id')
    expect(result[2]?.direction).toBe(SORT_ASC)
  })

  it('handles empty string', () => {
    expect(parseSort('')).toEqual([])
  })

  it('handles whitespace', () => {
    const result = parseSort('  -name , +created ')
    expect(result).toHaveLength(2)
  })
})

describe('buildSortExpr', () => {
  it('builds expression for simple field', () => {
    const resolver = new SimpleFieldResolver(['name'])
    const result = buildSortExpr({ name: 'name', direction: SORT_ASC }, resolver)
    expect(result).toContain('[[name]]')
    expect(result).toContain('ASC')
  })

  it('builds expression for descending field', () => {
    const resolver = new SimpleFieldResolver(['created'])
    const result = buildSortExpr({ name: 'created', direction: SORT_DESC }, resolver)
    expect(result).toContain('[[created]]')
    expect(result).toContain('DESC')
  })

  it('handles @random sort key', () => {
    const resolver = new SimpleFieldResolver([])
    const result = buildSortExpr({ name: '@random', direction: SORT_ASC }, resolver)
    expect(result).toBe('RANDOM()')
  })

  it('throws for unresolvable field', () => {
    const resolver = new SimpleFieldResolver(['name'])
    expect(() => buildSortExpr({ name: 'unknown', direction: SORT_ASC }, resolver)).toThrow(
      'invalid sort field "unknown"',
    )
  })
})
