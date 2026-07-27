import { describe, expect, it } from 'bun:test'
import { NormalizeUniqueIndexError } from '~/core/validators/db.ts'
import { ValidationErrors } from '~/core/validators/validators.ts'

describe('NormalizeUniqueIndexError', () => {
  it('returns null for null input', () => {
    expect(NormalizeUniqueIndexError(null, 'table', ['name'])).toBeNull()
  })

  it('returns ValidationErrors as-is', () => {
    const ve = new ValidationErrors({
      name: new (require('~/core/validators/validators.ts').ValidationError)('test', 'test'),
    })
    expect(NormalizeUniqueIndexError(ve, 'table', ['name'])).toBe(ve)
  })

  it('handles unique constraint violation messages', () => {
    const err = new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: users.email')
    const result = NormalizeUniqueIndexError(err, 'users', ['email'])
    expect(result).toBeInstanceOf(ValidationErrors)
    expect((result as ValidationErrors).errors).toHaveProperty('email')
  })

  it('handles postgres duplicate key messages', () => {
    const err = new Error('duplicate key value violates unique constraint "users.email"')
    const result = NormalizeUniqueIndexError(err, 'users', ['email'])
    expect(result).toBeInstanceOf(ValidationErrors)
    expect((result as ValidationErrors).errors).toHaveProperty('email')
  })

  it('returns original error for non-unique errors', () => {
    const err = new Error('some other error')
    expect(NormalizeUniqueIndexError(err, 'table', ['name'])).toBe(err)
  })
})
