import { describe, expect, it } from 'bun:test'
import {
  Collection,
  CollectionTypeAuth,
  CollectionTypeBase,
  CollectionTypeView,
  FieldsList,
} from '~/core/collection_model.ts'
import { CollectionAuthOptions, TokenConfig } from '~/core/collection_model_auth_options.ts'

// Register field types for FieldsList.fromJSON to work
import '~/core/field_text.ts'

describe('FieldsList', () => {
  it('starts empty', () => {
    const fl = new FieldsList()
    expect(fl.length).toBe(0)
  })

  it('adds fields', () => {
    const fl = new FieldsList()
    fl.add({
      id: 'f1',
      name: 'title',
      type: 'text',
      system: false,
      hidden: false,
      columnType: 'TEXT',
      settingsSchema: {},
    })
    fl.add({
      id: 'f2',
      name: 'body',
      type: 'text',
      system: false,
      hidden: false,
      columnType: 'TEXT',
      settingsSchema: {},
    })
    expect(fl.length).toBe(2)
  })

  it('getByName finds a field', () => {
    const fl = new FieldsList()
    fl.add({
      id: 'f1',
      name: 'title',
      type: 'text',
      system: false,
      hidden: false,
      columnType: 'TEXT',
      settingsSchema: {},
    })
    const f = fl.getByName('title')
    expect(f).toBeTruthy()
    expect(f?.id).toBe('f1')
  })

  it('getByName returns undefined for missing name', () => {
    const fl = new FieldsList()
    expect(fl.getByName('missing')).toBeUndefined()
  })

  it('getById finds a field', () => {
    const fl = new FieldsList()
    fl.add({
      id: 'f1',
      name: 'title',
      type: 'text',
      system: false,
      hidden: false,
      columnType: 'TEXT',
      settingsSchema: {},
    })
    const f = fl.getById('f1')
    expect(f).toBeTruthy()
    expect(f?.name).toBe('title')
  })

  it('remove removes a field by id', () => {
    const fl = new FieldsList()
    const field = {
      id: 'f1',
      name: 'title',
      type: 'text',
      system: false,
      hidden: false,
      columnType: 'TEXT',
      settingsSchema: {},
    }
    fl.add(field)
    expect(fl.length).toBe(1)

    fl.removeById(field.id)
    expect(fl.length).toBe(0)
  })

  it('getById finds a field', () => {
    const fl = new FieldsList()
    const field = {
      id: 'f1',
      name: 'title',
      type: 'text',
      system: false,
      hidden: false,
      columnType: 'TEXT',
      settingsSchema: {},
    }
    fl.add(field)
    const found = fl.getById('f1')
    expect(found).toBeTruthy()
    expect(found?.name).toBe('title')
  })

  it('fieldNames returns all names', () => {
    const fl = new FieldsList()
    fl.add({
      id: 'f1',
      name: 'a',
      type: 'text',
      system: false,
      hidden: false,
      columnType: 'TEXT',
      settingsSchema: {},
    })
    fl.add({
      id: 'f2',
      name: 'b',
      type: 'text',
      system: false,
      hidden: false,
      columnType: 'TEXT',
      settingsSchema: {},
    })
    expect(fl.fieldNames()).toEqual(['a', 'b'])
  })
})

describe('Collection', () => {
  it('creates a base collection', () => {
    const c = Collection.createBase('articles')
    expect(c.name).toBe('articles')
    expect(c.type).toBe(CollectionTypeBase)
    expect(c.isBase()).toBe(true)
    expect(c.isAuth()).toBe(false)
    expect(c.isView()).toBe(false)
  })

  it('creates an auth collection', () => {
    const c = Collection.createAuth('users')
    expect(c.name).toBe('users')
    expect(c.type).toBe(CollectionTypeAuth)
    expect(c.isAuth()).toBe(true)
    expect(c.authOptions).toBeTruthy()
  })

  it('creates a view collection', () => {
    const c = Collection.createView('active_users')
    expect(c.name).toBe('active_users')
    expect(c.type).toBe(CollectionTypeView)
    expect(c.isView()).toBe(true)
  })

  it('tableName returns _collections', () => {
    const c = new Collection()
    expect(c.tableName()).toBe('_collections')
  })

  it('baseFilesPath returns the collection id', () => {
    const c = new Collection()
    c.id = 'col123'
    expect(c.baseFilesPath()).toBe('col123')
  })

  it('index management works', () => {
    const c = new Collection()
    expect(c.getIndexes()).toEqual([])

    c.addIndex('CREATE UNIQUE INDEX idx_name ON articles (name)')
    expect(c.getIndexes().length).toBe(1)

    c.addIndex('CREATE INDEX idx_status ON articles (status)')
    expect(c.getIndexes().length).toBe(2)

    const removed = c.removeIndex('CREATE UNIQUE INDEX idx_name ON articles (name)')
    expect(removed).toBe(true)
    expect(c.getIndexes().length).toBe(1)
  })

  it('getAuthOptions throws for non-auth collections', () => {
    const c = Collection.createBase('test')
    expect(() => c.getAuthOptions()).toThrow('not an auth type')
  })

  it('getAuthOptions returns options for auth collections', () => {
    const c = Collection.createAuth('users')
    const opts = c.getAuthOptions()
    expect(opts).toBeInstanceOf(CollectionAuthOptions)
    expect(opts.authToken.secret.length).toBeGreaterThanOrEqual(30)
  })

  it('dbExport produces a flat record', () => {
    const c = Collection.createBase('test')
    c.id = 'col1'
    const exported = c.dbExport()
    expect(exported.id).toBe('col1')
    expect(exported.name).toBe('test')
    expect(exported.type).toBe(CollectionTypeBase)
    expect(typeof exported.indexes).toBe('string')
    expect(typeof exported.fields).toBe('string')
    expect(typeof exported.options).toBe('string')
  })

  it('toJSON redacts auth secrets', () => {
    const c = Collection.createAuth('users')
    c.id = 'col1'
    const json = c.toJSON()
    expect(json.id).toBe('col1')
    expect(json.name).toBe('users')
    expect(json.type).toBe(CollectionTypeAuth)
    expect(json.options).toBeTruthy()
    if (json.options && typeof json.options === 'object') {
      const opts = json.options as Record<string, unknown>
      expect(opts.authToken).toBeTruthy()
    }
  })

  it('loadFromJSON populates fields', () => {
    const c = new Collection()
    c.loadFromJSON({
      id: 'c1',
      name: 'posts',
      type: CollectionTypeBase,
      system: false,
      listRule: '',
      indexes: ['CREATE INDEX idx_name ON posts (name)'],
      fields: [
        {
          id: 'f1',
          name: 'title',
          type: 'text',
          system: true,
          hidden: false,
          columnType: 'TEXT',
          settingsSchema: {},
        },
      ],
    })
    expect(c.id).toBe('c1')
    expect(c.name).toBe('posts')
    expect(c.type).toBe(CollectionTypeBase)
    expect(c.indexes.length).toBe(1)
    expect(c.fields.length).toBe(1)
  })
})

describe('CollectionAuthOptions', () => {
  it('creates with default values', () => {
    const opts = Collection.createDefaultAuthOptions()
    expect(opts.authToken.secret.length).toBeGreaterThanOrEqual(30)
    expect(opts.authToken.duration).toBe(432000) // 5 days
    expect(opts.passwordAuth.enabled).toBe(true)
    expect(opts.oauth2.enabled).toBe(false)
    expect(opts.mfa.enabled).toBe(false)
  })

  it('serializes and deserializes', () => {
    const opts = Collection.createDefaultAuthOptions()
    const json = opts.toJSON()
    const restored = CollectionAuthOptions.fromJSON(json)
    expect(restored.authToken.duration).toBe(opts.authToken.duration)
    expect(restored.passwordAuth.enabled).toBe(opts.passwordAuth.enabled)
  })

  it('validation passes for default config', () => {
    const opts = Collection.createDefaultAuthOptions()
    const errors = opts.validate()
    expect(errors.length).toBe(0)
  })
})

describe('TokenConfig', () => {
  it('withRandomSecret creates a valid config', () => {
    const cfg = TokenConfig.withRandomSecret(3600)
    expect(cfg.secret.length).toBe(50)
    expect(cfg.duration).toBe(3600)
  })

  it('durationMs converts to milliseconds', () => {
    const cfg = new TokenConfig()
    cfg.duration = 60
    expect(cfg.durationMs()).toBe(60000)
  })

  it('validation rejects short secrets', () => {
    const cfg = new TokenConfig()
    cfg.secret = 'short'
    cfg.duration = 3600
    const errors = cfg.validate()
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toContain('secret')
  })
})
