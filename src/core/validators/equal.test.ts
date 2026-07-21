import { describe, it, expect } from 'bun:test'
import { Equal } from '~/core/validators/equal.ts'

describe('Equal', () => {
  it('returns null for matching strings', () => {
    expect(Equal('abc')('abc')).toBeNull()
  })

  it('returns error for non-matching strings', () => {
    const err = Equal('abc')('xyz')
    expect(err).not.toBeNull()
    expect(err!.code).toBe('validation_values_mismatch')
  })

  it('returns null for matching numbers', () => {
    expect(Equal(42)(42)).toBeNull()
  })

  it('returns error for non-matching numbers', () => {
    expect(Equal(42)(43)).not.toBeNull()
  })

  it('returns null for matching booleans', () => {
    expect(Equal(true)(true)).toBeNull()
    expect(Equal(false)(false)).toBeNull()
  })

  it('returns error for non-matching booleans', () => {
    expect(Equal(true)(false)).not.toBeNull()
  })

  it('returns null when both are null', () => {
    expect(Equal(null)(null)).toBeNull()
  })

  it('returns null when both are undefined', () => {
    expect(Equal(undefined)(undefined)).toBeNull()
  })

  it('returns error when one is null and the other is a value', () => {
    expect(Equal(null)('abc')).not.toBeNull()
    expect(Equal('abc')(null)).not.toBeNull()
  })

  it('returns error when types differ', () => {
    expect(Equal('123')(123)).not.toBeNull()
    expect(Equal(0)(false)).not.toBeNull()
  })
})
