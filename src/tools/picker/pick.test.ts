import { describe, expect, it } from 'bun:test'
import { Pick } from './pick.ts'

interface TestResponse {
  [key: string]: unknown
}

describe('Pick', () => {
  it('selects a single root field', () => {
    const data = { a: 1, b: 2, c: 3 }
    const result = Pick(data, 'a')
    expect(result).toEqual({ a: 1 })
  })

  it('selects multiple root fields', () => {
    const data = { a: 1, b: 2, c: 3 }
    const result = Pick(data, 'a,c')
    expect(result).toEqual({ a: 1, c: 3 })
  })

  it('selects nested fields via dot-notation', () => {
    const data = { a: 1, b: { b1: 11, b2: 22 } }
    const result = Pick(data, 'a,b.b1')
    expect(result).toEqual({ a: 1, b: { b1: 11 } })
  })

  it('returns full object for empty field string (Go matching behaviour)', () => {
    // Go's picker returns the full data when no fields are specified.
    const data = { a: 1, b: 2 }
    expect(Pick(data, '')).toEqual({ a: 1, b: 2 })
  })

  it('returns all fields for wildcard', () => {
    const data = { a: 1, b: 2, c: 3 }
    const result = Pick(data, '*') as Record<string, unknown>
    expect(result).toEqual({ a: 1, b: 2, c: 3 })
  })

  it('excludes fields with wildcard + exclusion', () => {
    const data = { a: 1, b: 2, c: 3 }
    const result = Pick(data, '*,-b') as Record<string, unknown>
    expect(result).toEqual({ a: 1, c: 3 })
  })

  it('excludes nested fields with wildcard + exclusion', () => {
    const data = { a: 1, b: { b1: 11, b2: 22 }, c: 3 }
    const result = Pick(data, '*,-b.b1') as Record<string, unknown>
    expect(result).toHaveProperty('a', 1)
    expect(result).toHaveProperty('c', 3)
    expect((result as TestResponse).b).toEqual({ b2: 22 })
  })

  it('handles arrays of objects', () => {
    const data = [
      { a: 1, b: 2 },
      { a: 3, b: 4 },
    ]
    const result = Pick(data, 'a')
    expect(result).toEqual([{ a: 1 }, { a: 3 }])
  })

  it('handles null/undefined values', () => {
    expect(Pick(null, 'a')).toBeNull()
    expect(Pick(undefined, 'a')).toBeUndefined()
  })

  it('deep clones data through JSON', () => {
    const data = { a: { nested: 'original' } }
    const result = Pick(data, 'a') as Record<string, unknown>
    const tmp = (result as TestResponse).a as TestResponse
    tmp.nested = 'modified'
    expect((data.a as TestResponse).nested).toBe('original')
  })

  it('handles deeply nested paths', () => {
    const data = { a: { b: { c: { d: 42 } } } }
    const result = Pick(data, 'a.b.c.d') as Record<string, unknown>
    expect(result).toEqual({ a: { b: { c: { d: 42 } } } })
  })

  it('handles multiple nested fields under same root', () => {
    const data = { user: { name: 'Alice', email: 'a@x.com', age: 30 } }
    const result = Pick(data, 'user.name,user.email') as Record<string, unknown>
    expect(result).toEqual({ user: { name: 'Alice', email: 'a@x.com' } })
  })

  it('excludes fields with exclusion-only (no wildcard)', () => {
    const data = { a: 1, b: 2, c: 3 }
    const result = Pick(data, '-b') as Record<string, unknown>
    expect(result).toEqual({ a: 1, c: 3 })
  })

  it('excludes multiple fields with exclusion-only', () => {
    const data = { a: 1, b: 2, c: 3, d: 4 }
    const result = Pick(data, '-b,-d') as Record<string, unknown>
    expect(result).toEqual({ a: 1, c: 3 })
  })

  it('excludes deeply nested sub-fields with wildcard', () => {
    const data = { a: { x: { p: 1, q: 2 }, y: 3 }, b: 4 }
    const result = Pick(data, '*,-a.x.q') as Record<string, unknown>
    const a = (result as TestResponse).a as TestResponse
    expect(a.x).toEqual({ p: 1 })
    expect(a.y).toBe(3)
    expect((result as TestResponse).b).toBe(4)
  })

  it('wildcard with multiple nested exclusions', () => {
    const data = {
      visible: 'ok',
      user: { name: 'Alice', email: 'a@x.com', ssn: '123-45-6789' },
      config: { secret: 'shh', public: 'hello' },
    }
    const result = Pick(data, '*,-user.ssn,-config.secret') as Record<string, unknown>
    expect((result as TestResponse).visible).toBe('ok')
    expect((result as TestResponse).user).toEqual({
      name: 'Alice',
      email: 'a@x.com',
    })
    expect((result as TestResponse).config).toEqual({ public: 'hello' })
  })

  it('handles complex real-world style selection', () => {
    const data = {
      id: 'abc123',
      name: 'Test',
      password: 'secret',
      profile: {
        bio: 'Hello world',
        age: 30,
        internal_id: 'xxx',
      },
      metadata: {
        created_at: '2024-01-01',
        updated_at: '2024-01-02',
      },
    }
    const result = Pick(
      data,
      'id,name,profile.bio,metadata.created_at,*,-password,-profile.internal_id,-metadata.updated_at',
    )
    expect(result).toEqual({
      id: 'abc123',
      name: 'Test',
      profile: { bio: 'Hello world' },
      metadata: { created_at: '2024-01-01' },
    })
  })
})
