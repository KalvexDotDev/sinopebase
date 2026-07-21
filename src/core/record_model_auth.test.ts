import { describe, it, expect } from 'bun:test'
import { Record } from '~/core/record_model.ts'
import { Collection } from '~/core/collection_model.ts'
import {
  recordEmail,
  setRecordEmail,
  recordTokenKey,
  refreshRecordTokenKey,
  setRecordPassword,
  setRecordRandomPassword,
} from '~/core/record_model_auth.ts'
import { isSuperuser, SuperusersCollectionName } from '~/core/record_model_superusers.ts'

describe('record_model_auth', () => {
  it('recordEmail and setRecordEmail', () => {
    const collection = Collection.createAuth('users')
    const record = new Record(collection)
    setRecordEmail(record, 'test@example.com')
    expect(recordEmail(record)).toBe('test@example.com')
  })

  it('recordTokenKey returns tokenKey', () => {
    const collection = Collection.createAuth('users')
    const record = new Record(collection)
    record.setRaw('tokenKey', 'my-token-key')
    expect(recordTokenKey(record)).toBe('my-token-key')
  })

  it('refreshRecordTokenKey triggers regeneration', () => {
    const collection = Collection.createAuth('users')
    const record = new Record(collection)
    refreshRecordTokenKey(record)
    // The tokenKey+ modifier should set it to empty string
    expect(record.getRaw('tokenKey+')).toBe('')
  })

  it('setRecordPassword sets the password field', () => {
    const collection = Collection.createAuth('users')
    const record = new Record(collection)
    setRecordPassword(record, 'my-password')
    expect(record.getRaw('password')).toBe('my-password')
  })

  it('setRecordRandomPassword generates a password', () => {
    const collection = Collection.createAuth('users')
    const record = new Record(collection)
    const pass = setRecordRandomPassword(record)
    expect(pass.length).toBe(30)
    expect(record.getRaw('password')).toBe(pass)
  })
})

describe('record_model_superusers', () => {
  it('isSuperuser returns true for _superusers collection', () => {
    const collection = Collection.createAuth(SuperusersCollectionName)
    const record = new Record(collection)
    expect(isSuperuser(record)).toBe(true)
  })

  it('isSuperuser returns false for other collections', () => {
    const collection = Collection.createAuth('users')
    const record = new Record(collection)
    expect(isSuperuser(record)).toBe(false)
  })
})
