import { describe, it, expect } from 'bun:test'
import { Record } from '~/core/record_model.ts'
import { Collection } from '~/core/collection_model.ts'
import { BaseRecordProxy } from '~/core/record_proxy.ts'

describe('BaseRecordProxy', () => {
  it('wraps a record', () => {
    const collection = Collection.createBase('articles')
    const record = new Record(collection)
    const proxy = new BaseRecordProxy(record)

    expect(proxy.getRecord()).toBe(record)
    expect(proxy.getCollection()).toBe(collection)
  })

  it('proxyGet and proxySet delegate to record', () => {
    const collection = Collection.createBase('articles')
    const record = new Record(collection)
    const proxy = new BaseRecordProxy(record)

    proxy.proxySet('title', 'Proxy Value')
    expect(proxy.proxyGet('title')).toBe('Proxy Value')
    expect(record.getRaw('title')).toBe('Proxy Value')
  })

  it('id getter/setter delegates', () => {
    const collection = Collection.createBase('articles')
    const record = new Record(collection)
    const proxy = new BaseRecordProxy(record)

    proxy.id = 'proxy-id'
    expect(proxy.id).toBe('proxy-id')
    expect(record.id).toBe('proxy-id')
  })

  it('toJSON delegates to record', () => {
    const collection = Collection.createBase('articles')
    const record = new Record(collection)
    record.id = 'rec1'
    const proxy = new BaseRecordProxy(record)

    const json = proxy.toJSON()
    expect(json.collectionId).toBe(collection.id)
    expect(json.collectionName).toBe(collection.name)
  })
})
