import { describe, it, expect } from 'bun:test'
import { Record, FieldNameId, FieldNameEmail } from '~/core/record_model.ts'
import { Collection } from '~/core/collection_model.ts'

describe('Record', () => {
  it('creates with a collection', () => {
    const collection = Collection.createBase('articles')
    const record = new Record(collection)
    expect(record.collection.name).toBe('articles')
    expect(record.isNew()).toBe(true)
    expect(record.id).toBe('')
  })

  it('tableName returns collection name', () => {
    const collection = Collection.createBase('articles')
    const record = new Record(collection)
    expect(record.tableName()).toBe('articles')
  })

  it('set and get raw values', () => {
    const collection = Collection.createBase('articles')
    const record = new Record(collection)
    record.setRaw('title', 'Hello World')
    expect(record.getRaw('title')).toBe('Hello World')
  })

  it('setRaw with id updates the id field', () => {
    const collection = Collection.createBase('articles')
    const record = new Record(collection)
    record.setRaw(FieldNameId, 'rec123')
    expect(record.id).toBe('rec123')
  })

  it('getRaw for id returns the id field', () => {
    const collection = Collection.createBase('articles')
    const record = new Record(collection)
    record.id = 'rec123'
    expect(record.getRaw(FieldNameId)).toBe('rec123')
  })

  it('set and get with field normalization', () => {
    const collection = Collection.createBase('articles')
    // Add a field
    collection.fields.add({
      id: 'f1',
      name: 'title',
      type: 'text',
      system: false,
      hidden: false,
      columnType: 'TEXT',
      settingsSchema: {},
    })

    const record = new Record(collection)
    record.set('title', 'My Article')
    expect(record.get('title')).toBe('My Article')
    expect(record.getString('title')).toBe('My Article')
  })

  it('load bulk sets data', () => {
    const collection = Collection.createBase('articles')
    const record = new Record(collection)
    record.load({ title: 'Bulk', views: 42 })
    expect(record.get('title')).toBe('Bulk')
    expect(record.getRaw('views')).toBe(42)
  })

  it('getString returns string', () => {
    const collection = Collection.createBase('test')
    const record = new Record(collection)
    record.setRaw('name', 'test')
    expect(record.getString('name')).toBe('test')
  })

  it('getBool returns boolean', () => {
    const collection = Collection.createBase('test')
    const record = new Record(collection)
    record.setRaw('active', true)
    expect(record.getBool('active')).toBe(true)

    record.setRaw('active', 'true')
    expect(record.getBool('active')).toBe(true)

    record.setRaw('active', false)
    expect(record.getBool('active')).toBe(false)
  })

  it('getNumber returns number', () => {
    const collection = Collection.createBase('test')
    const record = new Record(collection)
    record.setRaw('count', 42)
    expect(record.getNumber('count')).toBe(42)

    record.setRaw('count', '3.14')
    expect(record.getNumber('count')).toBe(3.14)
  })

  it('getStringSlice returns string array', () => {
    const collection = Collection.createBase('test')
    const record = new Record(collection)
    record.setRaw('tags', ['a', 'b', 'c'])
    expect(record.getStringSlice('tags')).toEqual(['a', 'b', 'c'])
  })

  it('expandData and setExpand', () => {
    const collection = Collection.createBase('test')
    const record = new Record(collection)
    expect(record.expandData()).toEqual({})

    record.setExpand({ author: { id: 'u1', name: 'John' } })
    expect(record.expandData().author).toBeTruthy()
  })

  it('expandedOne returns null when no expand', () => {
    const collection = Collection.createBase('test')
    const record = new Record(collection)
    expect(record.expandedOne('author')).toBeNull()
  })

  it('hide and unhide control visibility', () => {
    const collection = Collection.createBase('test')
    collection.fields.add({
      id: 'f1',
      name: 'secret',
      type: 'text',
      system: false,
      hidden: false,
      columnType: 'TEXT',
      settingsSchema: {},
    })

    const record = new Record(collection)
    record.setRaw('secret', 'hidden-value')
    record.hide('secret')

    const exported = record.publicExport()
    expect(exported.secret).toBeUndefined()

    record.unhide('secret')
    const exported2 = record.publicExport()
    expect(exported2.secret).toBe('hidden-value')
  })

  it('publicExport includes collection references', () => {
    const collection = Collection.createBase('test')
    collection.id = 'col1'
    const record = new Record(collection)
    record.id = 'rec1'

    const exported = record.publicExport()
    expect(exported.collectionId).toBe('col1')
    expect(exported.collectionName).toBe('test')
  })

  it('publicExport hides password and tokenKey for auth', () => {
    const collection = Collection.createAuth('users')
    // Add auth system fields so publicExport can iterate and access them
    collection.fields.add({
      id: 'f_email',
      name: 'email',
      type: 'email',
      system: true,
      hidden: false,
      columnType: 'TEXT DEFAULT ""',
      settingsSchema: { type: 'string' },
    })
    collection.fields.add({
      id: 'f_pwd',
      name: 'password',
      type: 'password',
      system: true,
      hidden: true,
      columnType: 'TEXT DEFAULT ""',
      settingsSchema: { type: 'string' },
    })
    collection.fields.add({
      id: 'f_tk',
      name: 'tokenKey',
      type: 'text',
      system: true,
      hidden: true,
      columnType: 'TEXT DEFAULT ""',
      settingsSchema: { type: 'string' },
    })
    collection.fields.add({
      id: 'f_ev',
      name: 'emailVisibility',
      type: 'bool',
      system: true,
      hidden: false,
      columnType: 'BOOLEAN DEFAULT FALSE',
      settingsSchema: { type: 'boolean' },
    })
    const record = new Record(collection)
    record.setRaw('password', 'secret-hash')
    record.setRaw('tokenKey', 'token-value')
    record.setRaw('email', 'test@example.com')
    record.setRaw('emailVisibility', true)

    const exported = record.publicExport()
    expect(exported.password).toBeUndefined()
    expect(exported.tokenKey).toBeUndefined()
    expect(exported.email).toBe('test@example.com')
  })

  it('clone creates a deep copy', () => {
    const collection = Collection.createBase('test')
    const record = new Record(collection)
    record.id = 'rec1'
    record.setRaw('title', 'Original')

    const cloned = record.clone()
    expect(cloned.id).toBe('rec1')
    expect(cloned.getRaw('title')).toBe('Original')

    // Modify original, clone should be unaffected
    record.setRaw('title', 'Modified')
    expect(cloned.getRaw('title')).toBe('Original')
  })

  it('fresh creates a copy with latest data', () => {
    const collection = Collection.createBase('test')
    collection.fields.add({
      id: 'f1',
      name: 'title',
      type: 'text',
      system: false,
      hidden: false,
      columnType: 'TEXT',
      settingsSchema: {},
    })

    const record = new Record(collection)
    record.setRaw('title', 'Latest')
    const fresh = record.fresh()
    expect(fresh.getRaw('title')).toBe('Latest')
  })

  it('original creates a copy with original data', () => {
    const collection = Collection.createBase('test')
    const record = new Record(collection)
    record.setRaw('title', 'Changed')
    const orig = record.original()
    // The original won't have the 'title' since it wasn't in originalData
    expect(orig.getRaw('title')).toBeUndefined()
  })
})
