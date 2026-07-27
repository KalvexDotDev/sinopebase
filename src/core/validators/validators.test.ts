import { describe, expect, it } from 'bun:test'
import {
  cutStr,
  ErrUnsupportedValueType,
  JoinValidationErrors,
  ValidationError,
  ValidationErrors,
} from '~/core/validators/validators.ts'

describe('ValidationError', () => {
  it('creates a named error with code and message', () => {
    const err = new ValidationError('test_code', 'Test error message')
    expect(err.code).toBe('test_code')
    expect(err.message).toBe('Test error message')
    expect(err.name).toBe('ValidationError')
  })

  it('supports withParams', () => {
    const err = new ValidationError('test_code', 'Min is {{.min}}')
    const withParams = err.withParams({ min: 5 })
    expect(withParams.params).toEqual({ min: 5 })
  })
})

describe('ValidationErrors', () => {
  it('wraps multiple field errors', () => {
    const errs = new ValidationErrors({
      name: new ValidationError('required', 'Name is required'),
      email: new ValidationError('format', 'Invalid email'),
    })
    expect(errs.name).toBe('ValidationErrors')
    expect(Object.keys(errs.errors)).toHaveLength(2)
  })
})

describe('ErrUnsupportedValueType', () => {
  it('is a static ValidationError instance', () => {
    expect(ErrUnsupportedValueType.code).toBe('validation_unsupported_value_type')
  })
})

describe('JoinValidationErrors', () => {
  it('returns null when both are null', () => {
    expect(JoinValidationErrors(null, null)).toBeNull()
  })

  it('returns the non-null error', () => {
    const err = new Error('test')
    expect(JoinValidationErrors(err, null)).toBe(err)
    expect(JoinValidationErrors(null, err)).toBe(err)
  })

  it('merges two ValidationErrors', () => {
    const errA = new ValidationErrors({ a: new ValidationError('err_a', 'Error A') })
    const errB = new ValidationErrors({ b: new ValidationError('err_b', 'Error B') })
    const merged = JoinValidationErrors(errA, errB)
    expect(merged).toBeInstanceOf(ValidationErrors)
    expect((merged as ValidationErrors).errors).toHaveProperty('a')
    expect((merged as ValidationErrors).errors).toHaveProperty('b')
  })

  it('returns first non-empty ValidationErrors', () => {
    const errA = new ValidationErrors({ a: new ValidationError('err_a', 'Error A') })
    const errB = new Error('plain error')
    const result = JoinValidationErrors(errA, errB)
    expect(result).toBe(errA)
  })

  it('joins two plain errors', () => {
    const result = JoinValidationErrors(new Error('err1'), new Error('err2'))
    expect(result).toBeInstanceOf(Error)
    expect(result?.message).toContain('err1')
    expect(result?.message).toContain('err2')
  })
})

describe('cutStr', () => {
  it('returns the string as-is when within max length', () => {
    expect(cutStr('hello', 10)).toBe('hello')
  })

  it('truncates and appends ... when over max length', () => {
    const result = cutStr('hello world', 8)
    expect(result).toBe('hello wo...')
    expect(result).toHaveLength(11)
  })

  it('handles empty strings', () => {
    expect(cutStr('', 10)).toBe('')
  })
})
