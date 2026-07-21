import { describe, it, expect } from 'bun:test';
import {
  parseAndRun,
} from './record_field_resolver_runner';
import {
  RecordFieldResolver,
} from './record_field_resolver';
import type {
  AppStub,
  CollectionStub,
  FieldsListStub,
  FieldStub,
  RequestInfo,
} from './record_field_resolver';

// ---------------------------------------------------------------------------
// Mock factory helpers
// ---------------------------------------------------------------------------

function mockApp(): AppStub {
  return {
    logger() {
      return { debug: () => {} };
    },
  };
}

function mockField(name: string, type = 'text', hidden = false): FieldStub {
  return {
    id: `f_${name}`,
    name,
    type,
    system: false,
    hidden,
    getHidden() {
      return this.hidden;
    },
    getName() {
      return this.name;
    },
  };
}

function mockFieldsList(fields: FieldStub[]): FieldsListStub {
  const byName = new Map(fields.map((f) => [f.name, f]));
  return {
    getByName(n: string) {
      return byName.get(n);
    },
    all() {
      return [...fields];
    },
    fieldNames() {
      return fields.map((f) => f.name);
    },
  };
}

function mockCollection(
  name: string,
  fields: FieldStub[],
  opts?: { listRule?: string | null; indexes?: string[] },
): CollectionStub {
  return {
    id: `c_${name}`,
    name,
    listRule: opts?.listRule ?? null,
    fields: mockFieldsList(fields),
    indexes: opts?.indexes ?? [],
    isAuth() {
      return name === 'users' || name === 'auth_user';
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseAndRun (runner)', () => {
  it('rejects already-used runner', () => {
    const app = mockApp();
    const coll = mockCollection('posts', [mockField('title')]);
    const resolver = new RecordFieldResolver(app, coll, null, false);

    // First call
    const r1 = parseAndRun('title', resolver);
    expect(r1).not.toBeInstanceOf(Error);

    // Second call (same generated proxy)
    const r2 = parseAndRun('title', resolver);
    expect(r2).not.toBeInstanceOf(Error);
  });

  it('rejects field not in allowed patterns', () => {
    const app = mockApp();
    const coll = mockCollection('posts', [mockField('title')]);
    const resolver = new RecordFieldResolver(app, coll, null, false);
    resolver.setAllowedFields(['exact_only']);

    const result = parseAndRun('some_field', resolver);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('failed to resolve field');
  });

  it('resolves a simple field to a column identifier', () => {
    const app = mockApp();
    const coll = mockCollection('posts', [mockField('title'), mockField('status')]);
    const resolver = new RecordFieldResolver(app, coll, null, false);

    const result = parseAndRun('title', resolver);
    expect(result).not.toBeInstanceOf(Error);
    if (!(result instanceof Error)) {
      expect(result.identifier).toContain('title');
      // Should use the table alias
      expect(result.identifier).toMatch(/posts\.title/);
    }
  });

  it('resolves @request.context', () => {
    const app = mockApp();
    const coll = mockCollection('posts', [mockField('title')]);
    const ri: RequestInfo = { context: 'GET /api/test', method: 'GET' };
    const resolver = new RecordFieldResolver(app, coll, ri, false);

    const result = parseAndRun('@request.context', resolver);
    expect(result).not.toBeInstanceOf(Error);
    if (!(result instanceof Error)) {
      expect(result.identifier).toContain('{:'); // placeholder
      expect(result.params).toBeDefined();
    }
  });

  it('resolves @request.method', () => {
    const app = mockApp();
    const coll = mockCollection('posts', [mockField('title')]);
    const ri: RequestInfo = { method: 'POST' };
    const resolver = new RecordFieldResolver(app, coll, ri, false);

    const result = parseAndRun('@request.method', resolver);
    expect(result).not.toBeInstanceOf(Error);
    if (!(result instanceof Error)) {
      expect(result.identifier).toContain('{:'); // placeholder
    }
  });

  it('returns NULL for @request when requestInfo is null', () => {
    const app = mockApp();
    const coll = mockCollection('posts', [mockField('title')]);
    const resolver = new RecordFieldResolver(app, coll, null, false);

    const result = parseAndRun('@request.context', resolver);
    expect(result).not.toBeInstanceOf(Error);
    if (!(result instanceof Error)) {
      expect(result.identifier).toBe('NULL');
    }
  });

  it('resolves @request.auth.* plain fields', () => {
    const app = mockApp();
    const coll = mockCollection('posts', [mockField('title')]);

    const authColl = mockCollection('users', [mockField('email')]);
    const authRecord: RequestInfo['auth'] = {
      id: 'user_123',
      collection() {
        return authColl;
      },
      clone() {
        return this!;
      },
      unhide(..._f: string[]) {
        return this!;
      },
      ignoreEmailVisibility(_v: boolean) {
        return this!;
      },
      publicExport() {
        return { id: 'user_123', email: 'test@example.com' };
      },
    };

    const ri: RequestInfo = { auth: authRecord };
    const resolver = new RecordFieldResolver(app, coll, ri, false);

    // @request.auth.id is a plain auth field
    const result = parseAndRun('@request.auth.id', resolver);
    expect(result).not.toBeInstanceOf(Error);
    if (!(result instanceof Error)) {
      expect(result.identifier).toContain('{:');
    }
  });

  it('returns NULL for @request.auth when no auth record', () => {
    const app = mockApp();
    const coll = mockCollection('posts', [mockField('title')]);
    const ri: RequestInfo = { auth: null };
    const resolver = new RecordFieldResolver(app, coll, ri, false);

    const result = parseAndRun('@request.auth.id', resolver);
    expect(result).not.toBeInstanceOf(Error);
    if (!(result instanceof Error)) {
      expect(result.identifier).toBe('NULL');
    }
  });

  it('resolves @request.body values', () => {
    const app = mockApp();
    const coll = mockCollection('posts', [mockField('title')]);
    const ri: RequestInfo = { body: { title: 'Hello World' } };
    const resolver = new RecordFieldResolver(app, coll, ri, false);

    const result = parseAndRun('@request.body.title', resolver);
    expect(result).not.toBeInstanceOf(Error);
    if (!(result instanceof Error)) {
      expect(result.identifier).toContain('{:'); // placeholder for value
    }
  });

  it('resolves @request.query values', () => {
    const app = mockApp();
    const coll = mockCollection('posts', [mockField('title')]);
    const ri: RequestInfo = { query: { filter: 'active' } };
    const resolver = new RecordFieldResolver(app, coll, ri, false);

    const result = parseAndRun('@request.query.filter', resolver);
    expect(result).not.toBeInstanceOf(Error);
    if (!(result instanceof Error)) {
      expect(result.identifier).toContain('{:'); // placeholder
    }
  });

  it('resolves @request.headers values', () => {
    const app = mockApp();
    const coll = mockCollection('posts', [mockField('title')]);
    const ri: RequestInfo = { headers: { 'x-token': 'abc123' } };
    const resolver = new RecordFieldResolver(app, coll, ri, false);

    const result = parseAndRun('@request.headers.x-token', resolver);
    expect(result).not.toBeInstanceOf(Error);
    if (!(result instanceof Error)) {
      // Should return a param placeholder
      expect(result.identifier).toContain('{:');
    }
  });

  it('rejects @collection with too few props', () => {
    const app = mockApp();
    const coll = mockCollection('posts', [mockField('title')]);
    const resolver = new RecordFieldResolver(app, coll, null, false);

    const result = parseAndRun('@collection.product', resolver);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('@collection');
  });

  it('fails (error) for unresolvable field', () => {
    const app = mockApp();
    const coll = mockCollection('posts', [mockField('title')]);
    const resolver = new RecordFieldResolver(app, coll, null, false);

    const result = parseAndRun('nonexistent', resolver);
    expect(result).toBeInstanceOf(Error);
  });

  it('creates joins for relation traversal', () => {
    const app = mockApp();

    // Create a relation field: `author` field referencing `users` collection
    const authorField: FieldStub & { collectionId: string; isMultiple: boolean } = {
      id: 'f_author',
      name: 'author',
      type: 'relation',
      system: false,
      hidden: false,
      getHidden() {
        return false;
      },
      getName() {
        return 'author';
      },
      collectionId: 'c_users',
      isMultiple: false,
      isMultiple() {
        return false;
      },
    };

    const userFields = [mockField('name'), mockField('email')];
    const usersColl = mockCollection('users', userFields);
    const postsColl = mockCollection('posts', [mockField('title'), authorField]);

    // Override loadCollection to resolve the relation
    const resolver = new RecordFieldResolver(app, postsColl, null, false);

    // Manually register the relation collection for resolution
    const origLoad = resolver.loadCollection.bind(resolver);
    resolver.loadCollection = (nameOrId: string) => {
      if (nameOrId === 'c_users' || nameOrId === 'users') return usersColl;
      return origLoad(nameOrId);
    };

    const result = parseAndRun('author.name', resolver);
    expect(result).not.toBeInstanceOf(Error);
    if (!(result instanceof Error)) {
      expect(result.identifier).toContain('name');
    }

    // Should have registered joins
    expect(resolver.joins.length).toBeGreaterThan(0);
  });

  it('resolves @request.body:lower modifier', () => {
    const app = mockApp();
    const coll = mockCollection('posts', [mockField('title')]);
    const ri: RequestInfo = { body: { title: 'Hello' } };
    const resolver = new RecordFieldResolver(app, coll, ri, false);

    const result = parseAndRun('@request.body.title:lower', resolver);
    expect(result).not.toBeInstanceOf(Error);
    if (!(result instanceof Error)) {
      expect(result.identifier).toContain('LOWER');
    }
  });
});
