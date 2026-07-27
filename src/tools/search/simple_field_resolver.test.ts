import { describe, expect, it } from 'bun:test'
import { NullFallbackPreference, SimpleFieldResolver } from './simple_field_resolver'

describe('SimpleFieldResolver', () => {
  it('resolves single allowed field', () => {
    const resolver = new SimpleFieldResolver(['name', 'id', 'created'])
    const result = resolver.resolve('name')
    expect(result instanceof Error).toBe(false)
    if (!(result instanceof Error)) {
      expect(result.identifier).toContain('name')
    }
  })

  it('returns error for disallowed field', () => {
    const resolver = new SimpleFieldResolver(['name', 'id'])
    const result = resolver.resolve('email')
    expect(result instanceof Error).toBe(true)
    if (result instanceof Error) {
      expect(result.message).toContain('failed to resolve field "email"')
    }
  })

  it('resolves dotted path as JSON path', () => {
    const resolver = new SimpleFieldResolver(['^\\w+[\\.\\w]*$'])
    const result = resolver.resolve('data.email')
    expect(result instanceof Error).toBe(false)
    if (!(result instanceof Error)) {
      expect(result.identifier).toContain('>>')
      expect(result.identifier).toContain('data')
      expect(result.identifier).toContain('email')
      expect(result.nullFallback).toBe(NullFallbackPreference.Disabled)
    }
  })

  it('resolves nested JSON path with -> for intermediate segments', () => {
    const resolver = new SimpleFieldResolver(['^\\w+[\\.\\w]*$'])
    const result = resolver.resolve('meta.address.city')
    expect(result instanceof Error).toBe(false)
    if (!(result instanceof Error)) {
      expect(result.identifier).toContain("->'address'")
      expect(result.identifier).toContain("->>'city'")
    }
  })

  it('updateQuery is no-op', () => {
    const resolver = new SimpleFieldResolver(['name'])
    expect(() => resolver.updateQuery(null)).not.toThrow()
  })

  it('allows all fields when no allowed list specified', () => {
    const resolver = new SimpleFieldResolver([])
    const result = resolver.resolve('anything')
    expect(result instanceof Error).toBe(false)
  })
})
