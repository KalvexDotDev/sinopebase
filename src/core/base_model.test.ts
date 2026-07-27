import { describe, expect, it } from 'bun:test'
import { BaseModel } from '~/core/base_model.ts'
import { DateTime } from '~/tools/types/datetime.ts'

describe('BaseModel', () => {
  it('creates with default values', () => {
    const m = new BaseModel()
    expect(m.id).toBe('')
    expect(m.hasId()).toBe(false)
    expect(m.isNew()).toBe(true)
    expect(m.lastSavedPKValue()).toBe('')
  })

  it('setId updates the id', () => {
    const m = new BaseModel()
    m.setId('abc123')
    expect(m.id).toBe('abc123')
    expect(m.hasId()).toBe(true)
  })

  it('markAsNew and markAsNotNew toggle state', () => {
    const m = new BaseModel()
    expect(m.isNew()).toBe(true)

    m.markAsNotNew()
    expect(m.isNew()).toBe(false)
    expect(m.lastSavedPKValue()).toBe('')

    m.id = 'saved-id'
    m.markAsNotNew()
    expect(m.isNew()).toBe(false)
    expect(m.lastSavedPKValue()).toBe('saved-id')

    m.markAsNew()
    expect(m.isNew()).toBe(true)
    expect(m.lastSavedPKValue()).toBe('')
  })

  it('postScan throws on empty id', () => {
    const m = new BaseModel()
    expect(() => m.postScan()).toThrow('missing primary key')
  })

  it('postScan marks as not new', () => {
    const m = new BaseModel()
    m.id = 'valid-id'
    m.postScan()
    expect(m.isNew()).toBe(false)
    expect(m.lastSavedPKValue()).toBe('valid-id')
  })

  it('generateId produces a valid id string', () => {
    const m = new BaseModel()
    // Access the protected method via casting
    const id = (m as unknown as { generateId(): string }).generateId()
    expect(id).toBeTruthy()
    expect(id.length).toBeGreaterThanOrEqual(8)
    expect(id.startsWith('r')).toBe(true)
  })

  it('refreshId generates a new id', () => {
    const m = new BaseModel()
    m.refreshId()
    expect(m.id).toBeTruthy()
    expect(m.id.length).toBeGreaterThanOrEqual(8)
  })

  it('created and updated are DateTime instances', () => {
    const m = new BaseModel()
    expect(m.created).toBeInstanceOf(DateTime)
    expect(m.updated).toBeInstanceOf(DateTime)
  })
})
