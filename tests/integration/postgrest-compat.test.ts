// @new-code-test positive src/apis/postgrest.ts
// @new-code-test negative src/apis/postgrest.ts
// @new-code-test positive src/core/db-postgres.ts
// @new-code-test negative src/core/db-postgres.ts
/**
 * PostgREST compatibility over real PostgreSQL: upsert conflict targets,
 * exact counts, SQLSTATE error mapping, mutation projection/embedding and
 * singular-mutation rollback. PostgREST semantics are the contract.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { mountPostgrestRoutes } from '~/apis/postgrest'
import { PostgresDatabase } from '~/core/db-postgres'
import { requirePostgres } from '../harness'

const singular = 'application/vnd.pgrst.object+json'
const parentA = '0a000000-0000-4000-8000-00000000000a'
const parentB = '0b000000-0000-4000-8000-00000000000b'
const missingParent = '00000000-0000-4000-8000-000000000000'

let db: PostgresDatabase
let app: Elysia

beforeAll(async () => {
  db = new PostgresDatabase({ postgresUrl: requirePostgres() })
  await db.connect()
  await db.getPool().query(`
  DO $$ BEGIN
   IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
   IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  END $$;
  DROP TABLE IF EXISTS compat_child, compat_parent, compat_profile, compat_locked;
  CREATE TABLE compat_parent (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
  CREATE TABLE compat_child (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id uuid REFERENCES compat_parent(id),
    label text NOT NULL DEFAULT 'x',
    n int CHECK (n IS NULL OR n >= 0),
    code text UNIQUE
  );
  CREATE TABLE compat_profile (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    region text NOT NULL DEFAULT 'eu',
    phone text,
    tags jsonb,
    UNIQUE (tenant_id, region)
  );
  CREATE TABLE compat_locked (id text PRIMARY KEY, body text);
  ALTER TABLE compat_locked ENABLE ROW LEVEL SECURITY;
  CREATE POLICY locked_read ON compat_locked FOR SELECT USING (true);
  GRANT ALL ON compat_parent, compat_child, compat_profile, compat_locked TO authenticated, anon;
 `)
  app = new Elysia()
  mountPostgrestRoutes(app, db, (request) => ({
    role: request.headers.get('x-test-role') === 'anon' ? 'anon' : 'authenticated',
    userId: 'compat-user',
  }))
})

beforeEach(async () => {
  await db.getPool().query(`
  TRUNCATE compat_child, compat_parent, compat_profile, compat_locked;
  INSERT INTO compat_parent (id, name) VALUES ('${parentA}', 'a'), ('${parentB}', 'b');
  INSERT INTO compat_child (parent_id, label, code) VALUES
    ('${parentA}', 'c1', 'k1'), ('${parentA}', 'c2', 'k2'),
    ('${parentB}', 'c3', 'k3'), (NULL, 'orphan', 'k4'), ('${parentB}', 'c5', 'k5');
 `)
})

afterAll(async () => {
  await db
    ?.getPool()
    .query('DROP TABLE IF EXISTS compat_child, compat_parent, compat_profile, compat_locked')
  await db?.close()
})

async function call(
  method: string,
  path: string,
  options: { body?: unknown; prefer?: string; accept?: string; role?: 'anon' } = {},
) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (options.prefer) headers.prefer = options.prefer
  if (options.accept) headers.accept = options.accept
  if (options.role) headers['x-test-role'] = options.role
  const response = await app.handle(
    new Request(`http://localhost/rest/v1/${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
  )
  const text = await response.text()
  return { response, body: text ? JSON.parse(text) : undefined }
}

async function rows(query: string) {
  return (await db.getPool().query(query)).rows as Record<string, unknown>[]
}

describe('upsert conflict targets', () => {
  const merge = 'resolution=merge-duplicates,return=representation'
  const ignore = 'resolution=ignore-duplicates,return=representation'

  it('merges on the on_conflict columns and updates only provided columns', async () => {
    const first = await call('POST', 'compat_profile?on_conflict=tenant_id,region', {
      body: { tenant_id: 't1', region: 'eu', phone: '1', tags: [] },
      prefer: merge,
    })
    expect(first.response.status).toBe(201)
    const second = await call('POST', 'compat_profile?on_conflict=tenant_id,region', {
      body: { tenant_id: 't1', region: 'eu', phone: '2', tags: ['a'] },
      prefer: merge,
    })
    expect(second.response.status).toBe(201)
    expect(second.body).toMatchObject([{ tenant_id: 't1', phone: '2', tags: ['a'] }])
    expect(second.body[0].id).toBe(first.body[0].id)
    expect(await rows('SELECT tenant_id, phone, tags FROM compat_profile')).toEqual([
      { tenant_id: 't1', phone: '2', tags: ['a'] },
    ])
  })

  it('does nothing on conflict with ignore-duplicates and returns only inserted rows', async () => {
    await call('POST', 'compat_profile?on_conflict=tenant_id,region', {
      body: { tenant_id: 't1', region: 'eu', phone: '1' },
      prefer: merge,
    })
    const ignored = await call('POST', 'compat_profile?on_conflict=tenant_id,region', {
      body: [
        { tenant_id: 't1', region: 'eu', phone: '3' },
        { tenant_id: 't2', region: 'eu', phone: '4' },
      ],
      prefer: ignore,
    })
    expect(ignored.response.status).toBe(201)
    expect(ignored.body).toMatchObject([{ tenant_id: 't2', phone: '4' }])
    expect(ignored.body).toHaveLength(1)
    expect(await rows('SELECT tenant_id, phone FROM compat_profile ORDER BY tenant_id')).toEqual([
      { tenant_id: 't1', phone: '1' },
      { tenant_id: 't2', phone: '4' },
    ])
  })

  it('defaults the conflict target to the primary key', async () => {
    const created = await call('POST', 'compat_profile', {
      body: { tenant_id: 't1', phone: '1' },
      prefer: merge,
    })
    const id = created.body[0].id
    const merged = await call('POST', 'compat_profile', {
      body: { id, tenant_id: 't1', phone: '9' },
      prefer: merge,
    })
    expect(merged.response.status).toBe(201)
    expect(await rows('SELECT phone FROM compat_profile')).toEqual([{ phone: '9' }])
  })

  it('rejects on_conflict values that are not plain identifiers', async () => {
    const { response } = await call('POST', 'compat_profile?on_conflict=tenant_id);drop', {
      body: { tenant_id: 't1' },
      prefer: merge,
    })
    expect(response.status).toBe(400)
    expect(await rows('SELECT 1 FROM compat_profile')).toEqual([])
  })
})

describe('exact counts on GET', () => {
  it('counts every matching row regardless of limit and reports the range', async () => {
    const limited = await call('GET', 'compat_child?select=id&order=label&limit=2', {
      prefer: 'count=exact',
    })
    expect(limited.body).toHaveLength(2)
    expect(limited.response.headers.get('content-range')).toBe('0-1/5')

    const paged = await call('GET', 'compat_child?select=id&offset=2&limit=2', {
      prefer: 'count=exact',
    })
    expect(paged.body).toHaveLength(2)
    expect(paged.response.headers.get('content-range')).toBe('2-3/5')

    const filtered = await call('GET', `compat_child?parent_id=eq.${parentA}&limit=1`, {
      prefer: 'count=exact',
    })
    expect(filtered.response.headers.get('content-range')).toBe('0-0/2')
  })

  it('counts rows kept by an !inner embed, not the page', async () => {
    const { body, response } = await call(
      'GET',
      'compat_child?select=label,compat_parent!inner(name)&order=label&limit=1',
      { prefer: 'count=exact' },
    )
    expect(body).toHaveLength(1)
    expect(response.headers.get('content-range')).toBe('0-0/4')
  })

  it('reports an empty page as */total', async () => {
    const { response } = await call('GET', 'compat_child?offset=10&limit=2', {
      prefer: 'count=exact',
    })
    expect(response.headers.get('content-range')).toBe('*/5')
  })
})

describe('database errors use PostgREST SQLSTATE responses', () => {
  const cases: {
    name: string
    method: string
    path: string
    body?: unknown
    status: number
    code: string
    role?: 'anon'
  }[] = [
    {
      name: 'insert foreign-key violation',
      method: 'POST',
      path: 'compat_child',
      body: { parent_id: missingParent, code: 'kx' },
      status: 409,
      code: '23503',
    },
    {
      name: 'insert check violation',
      method: 'POST',
      path: 'compat_child',
      body: { n: -1, code: 'ky' },
      status: 400,
      code: '23514',
    },
    {
      name: 'insert not-null violation',
      method: 'POST',
      path: 'compat_child',
      body: { label: null, code: 'kz' },
      status: 400,
      code: '23502',
    },
    {
      name: 'insert invalid text representation',
      method: 'POST',
      path: 'compat_child',
      body: { parent_id: 'not-a-uuid' },
      status: 400,
      code: '22P02',
    },
    {
      name: 'insert unique violation',
      method: 'POST',
      path: 'compat_child',
      body: { code: 'k1' },
      status: 409,
      code: '23505',
    },
    {
      name: 'update unique violation',
      method: 'PATCH',
      path: 'compat_child?code=eq.k2',
      body: { code: 'k1' },
      status: 409,
      code: '23505',
    },
    {
      name: 'update foreign-key violation',
      method: 'PATCH',
      path: 'compat_child?code=eq.k2',
      body: { parent_id: missingParent },
      status: 409,
      code: '23503',
    },
    {
      name: 'delete a referenced row',
      method: 'DELETE',
      path: `compat_parent?id=eq.${parentA}`,
      status: 409,
      code: '23503',
    },
    {
      name: 'authenticated row-level security denial',
      method: 'POST',
      path: 'compat_locked',
      body: { id: 'x' },
      status: 403,
      code: '42501',
    },
    {
      name: 'anonymous row-level security denial',
      method: 'POST',
      path: 'compat_locked',
      body: { id: 'x' },
      status: 401,
      code: '42501',
      role: 'anon',
    },
  ]

  for (const testCase of cases) {
    it(`maps ${testCase.name} to ${testCase.status} ${testCase.code}`, async () => {
      const { response, body } = await call(testCase.method, testCase.path, {
        body: testCase.body,
        role: testCase.role,
      })
      expect(response.status).toBe(testCase.status)
      expect(Object.keys(body).sort()).toEqual(['code', 'details', 'hint', 'message'])
      expect(body.code).toBe(testCase.code)
      expect(typeof body.message).toBe('string')
    })
  }

  it('reports the constraint detail like PostgREST', async () => {
    const { body } = await call('POST', 'compat_child', {
      body: { parent_id: missingParent, code: 'kx' },
    })
    expect(body.details).toContain(missingParent)
    expect(body.hint).toBeNull()
  })
})

describe('select on mutations with return=representation', () => {
  const prefer = 'return=representation'

  it('projects and embeds inserted rows', async () => {
    const { response, body } = await call('POST', 'compat_child?select=label,compat_parent(name)', {
      body: { parent_id: parentA, label: 'c6', code: 'k6' },
      prefer,
    })
    expect(response.status).toBe(201)
    expect(body).toEqual([{ label: 'c6', compat_parent: { name: 'a' } }])
  })

  it('projects updated rows', async () => {
    const { body } = await call('PATCH', 'compat_child?code=eq.k1&select=code,label', {
      body: { label: 'changed' },
      prefer,
    })
    expect(body).toEqual([{ code: 'k1', label: 'changed' }])
  })

  it('projects and embeds deleted rows', async () => {
    const { body } = await call(
      'DELETE',
      'compat_child?code=eq.k3&select=code,compat_parent(name)',
      {
        prefer,
      },
    )
    expect(body).toEqual([{ code: 'k3', compat_parent: { name: 'b' } }])
  })

  it('returns a single projected object for single()', async () => {
    const { response, body } = await call('POST', 'compat_child?select=code', {
      body: { code: 'k7' },
      prefer,
      accept: singular,
    })
    expect(response.status).toBe(201)
    expect(body).toEqual({ code: 'k7' })
  })
})

describe('single() on mutations', () => {
  it('rolls back an update that does not affect exactly one row', async () => {
    const { response, body } = await call('PATCH', `compat_child?parent_id=eq.${parentB}`, {
      body: { label: 'CHANGED' },
      prefer: 'return=representation',
      accept: singular,
    })
    expect(response.status).toBe(406)
    expect(body).toMatchObject({ code: 'PGRST116' })
    expect(await rows(`SELECT label FROM compat_child WHERE label = 'CHANGED'`)).toEqual([])
  })

  it('rolls back a delete that does not affect exactly one row', async () => {
    const { response } = await call('DELETE', `compat_child?parent_id=eq.${parentA}`, {
      accept: singular,
    })
    expect(response.status).toBe(406)
    expect(await rows('SELECT 1 FROM compat_child')).toHaveLength(5)
  })
})
