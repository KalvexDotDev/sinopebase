import { describe, expect, it } from 'bun:test'
import type {
  AppStub,
  CollectionStub,
  FieldStub,
  FieldsListStub,
  RecordStub,
  RequestInfo,
} from './record_field_resolver'
import {
  EachModifier,
  extractNestedVal,
  RecordFieldResolver,
  splitModifier,
  toSlice,
} from './record_field_resolver'

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockField(name: string, type = 'text', hidden = false): FieldStub {
  return {
    id: `fld_${name}`,
    name,
    type,
    system: false,
    hidden,
    getHidden() {
      return this.hidden
    },
    getName() {
      return this.name
    },
  }
}

function createMockFieldsList(fields: FieldStub[]): FieldsListStub {
  const map = new Map(fields.map((f) => [f.name, f]))
  return {
    getByName(name: string) {
      return map.get(name)
    },
    all() {
      return [...fields]
    },
    fieldNames() {
      return fields.map((f) => f.name)
    },
  }
}

function createMockCollection(
  name: string,
  fields: FieldStub[],
  opts?: {
    listRule?: string | null
    isAuth?: boolean
    indexes?: string[]
  },
): CollectionStub {
  return {
    id: `coll_${name}`,
    name,
    listRule: opts?.listRule ?? null,
    fields: createMockFieldsList(fields),
    indexes: opts?.indexes ?? [],
    isAuth() {
      return opts?.isAuth ?? false
    },
  }
}

function createMockRecord(id: string, collection: CollectionStub): RecordStub {
  return {
    id,
    collection() {
      return collection
    },
    clone() {
      return createMockRecord(id, collection)
    },
    unhide(..._fields: string[]) {
      return this
    },
    ignoreEmailVisibility(_v: boolean) {
      return this
    },
    publicExport() {
      return { id, email: 'test@example.com' }
    },
  }
}

function createMockApp(): AppStub {
  return {
    logger() {
      return {
        debug(_msg: string, ..._args: unknown[]) {
          // no-op
        },
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('splitModifier', () => {
  it('splits name:modifier', () => {
    const [name, mod] = splitModifier('role:each')
    expect(name).toBe('role')
    expect(mod).toBe(EachModifier)
  })

  it('returns name, "" for plain field', () => {
    const [name, mod] = splitModifier('name')
    expect(name).toBe('name')
    expect(mod).toBe('')
  })

  it('handles all valid modifiers', () => {
    expect(splitModifier('f:each')).toEqual(['f', 'each'])
    expect(splitModifier('f:isset')).toEqual(['f', 'isset'])
    expect(splitModifier('f:length')).toEqual(['f', 'length'])
    expect(splitModifier('f:lower')).toEqual(['f', 'lower'])
    expect(splitModifier('f:changed')).toEqual(['f', 'changed'])
  })

  it('throws on unknown modifier', () => {
    expect(() => splitModifier('name:foo')).toThrow('unknown modifier')
  })

  it('handles last-dot field with modifier', () => {
    const [name, mod] = splitModifier('relation.field:each')
    expect(name).toBe('relation.field')
    expect(mod).toBe('each')
  })
})

describe('extractNestedVal', () => {
  it('extracts a top-level key from a map', () => {
    expect(extractNestedVal({ a: 1 }, 'a')).toBe(1)
  })

  it('extracts nested keys', () => {
    expect(extractNestedVal({ a: { b: { c: 'deep' } } }, 'a', 'b', 'c')).toBe('deep')
  })

  it('extracts from arrays by index', () => {
    expect(extractNestedVal([10, 20, 30], '1')).toBe(20)
  })

  it('extracts nested array inside map', () => {
    expect(extractNestedVal({ items: ['a', 'b', 'c'] }, 'items', '2')).toBe('c')
  })

  it('throws on missing key', () => {
    expect(() => extractNestedVal({ a: 1 }, 'b')).toThrow('missing key')
  })

  it('throws on out-of-bounds array index', () => {
    expect(() => extractNestedVal([1, 2], '5')).toThrow('invalid')
  })

  it('throws on empty keys', () => {
    expect(() => extractNestedVal({ a: 1 })).toThrow('at least one key')
  })

  it('extracts from JSON string', () => {
    expect(extractNestedVal('{"a":42}', 'a')).toBe(42)
  })
})

describe('toSlice', () => {
  it('returns empty array for null', () => {
    expect(toSlice(null)).toEqual([])
  })

  it('returns empty array for undefined', () => {
    expect(toSlice(undefined)).toEqual([])
  })

  it('returns single element as array', () => {
    expect(toSlice(42)).toEqual([42])
  })

  it('returns array as-is', () => {
    expect(toSlice([1, 2, 3])).toEqual([1, 2, 3])
  })
})

describe('RecordFieldResolver', () => {
  describe('constructor and basic accessors', () => {
    const fields = [createMockField('title'), createMockField('status')]
    const collection = createMockCollection('posts', fields)
    const app = createMockApp()

    it('initializes with default values', () => {
      const resolver = new RecordFieldResolver(app, collection, null, false)

      expect(resolver.allowedFields()).toContain('^\\w+[\\w\\.\\:]*$')
      expect(resolver.getAllowHiddenFields()).toBe(false)
      expect(resolver.joins).toEqual([])
      expect(resolver.listRuleJoins).toEqual([])
    })

    it('initializes with allowHiddenFields = true', () => {
      const resolver = new RecordFieldResolver(app, collection, null, true)
      expect(resolver.getAllowHiddenFields()).toBe(true)
    })

    it('sets allowed fields', () => {
      const resolver = new RecordFieldResolver(app, collection, null, false)
      resolver.setAllowedFields(['name', 'email'])
      expect(resolver.allowedFields()).toEqual(['name', 'email'])
    })

    it('sets allow hidden fields', () => {
      const resolver = new RecordFieldResolver(app, collection, null, false)
      resolver.setAllowHiddenFields(true)
      expect(resolver.getAllowHiddenFields()).toBe(true)
    })
  })

  describe('with RequestInfo', () => {
    const fields = [createMockField('title'), createMockField('status')]
    const collection = createMockCollection('posts', fields)
    const app = createMockApp()

    it('builds staticRequestInfo from requestInfo', () => {
      const authColl = createMockCollection('users', [createMockField('name')], { isAuth: true })
      const authRecord = createMockRecord('abc123', authColl)

      const ri: RequestInfo = {
        context: 'GET /api/collections/posts/records',
        method: 'GET',
        auth: authRecord,
        body: { title: 'Hello' },
        query: { filter: 'status=active' },
        headers: { 'x-token': 'test' },
      }

      const resolver = new RecordFieldResolver(app, collection, ri, false)

      // Static request info should include the auth export
      expect(resolver.staticRequestInfo.context).toBe(ri.context)
      expect(resolver.staticRequestInfo.method).toBe(ri.method)
      expect(resolver.staticRequestInfo.body).toEqual({ title: 'Hello' })
    })

    it('handles null requestInfo', () => {
      const resolver = new RecordFieldResolver(app, collection, null, false)
      expect(resolver.staticRequestInfo).toEqual({})
    })
  })

  describe('resolveStaticRequestField', () => {
    const fields = [createMockField('title'), createMockField('status')]
    const collection = createMockCollection('posts', fields)
    const app = createMockApp()

    it('returns error for empty path', () => {
      const resolver = new RecordFieldResolver(app, collection, null, false)
      const result = resolver.resolveStaticRequestField()
      expect(result).toBeInstanceOf(Error)
    })

    it('resolves static string values', () => {
      const ri: RequestInfo = {
        context: 'GET /api/test',
        method: 'GET',
      }
      const resolver = new RecordFieldResolver(app, collection, ri, false)

      const result = resolver.resolveStaticRequestField('context')
      expect(result).not.toBeInstanceOf(Error)
      if (!(result instanceof Error)) {
        expect(result.identifier).toContain('{:')
        expect(result.params).toBeDefined()
      }
    })

    it('resolves null values as NULL identifier', () => {
      const ri: RequestInfo = {}
      const resolver = new RecordFieldResolver(app, collection, ri, false)

      // auth is null in staticRequestInfo when requestInfo.auth is null
      const result = resolver.resolveStaticRequestField('auth')
      expect(result).not.toBeInstanceOf(Error)
      if (!(result instanceof Error)) {
        expect(result.identifier).toBe('NULL')
      }
    })
  })

  describe('registerJoin', () => {
    const fields = [createMockField('title'), createMockField('status')]
    const collection = createMockCollection('posts', fields)
    const app = createMockApp()

    it('adds a new join', () => {
      const resolver = new RecordFieldResolver(app, collection, null, false)
      resolver.registerJoin('users', 'users_alias', 'users_alias.id = posts.user')
      expect(resolver.joins).toHaveLength(1)
      expect(resolver.joins[0]?.tableAlias).toBe('users_alias')
    })

    it('replaces existing join with same alias', () => {
      const resolver = new RecordFieldResolver(app, collection, null, false)
      resolver.registerJoin('users', 'users_alias', 'old on')
      resolver.registerJoin('profiles', 'users_alias', 'new on')
      expect(resolver.joins).toHaveLength(1)
      expect(resolver.joins[0]?.tableName).toBe('profiles')
    })

    it('registers list rule join when collection is found', () => {
      const resolver = new RecordFieldResolver(app, collection, null, false)
      resolver.registerJoin('posts', 'posts_alias', '')
      expect(resolver.listRuleJoins).toHaveLength(1)
      expect(resolver.listRuleJoins[0]?.tableAlias).toBe('posts_alias')
    })
  })

  describe('resolve method', () => {
    const app = createMockApp()
    const fields = [createMockField('title'), createMockField('status')]
    const collection = createMockCollection('posts', fields)

    it('returns error asking to use parseAndRun', () => {
      const resolver = new RecordFieldResolver(app, collection, null, false)
      const result = resolver.resolve('title')
      expect(result).toBeInstanceOf(Error)
      expect((result as Error).message).toContain('parseAndRun')
    })
  })
})
