// @new-code-test positive src/apis/postgrest.ts
// @new-code-test negative src/apis/postgrest.ts
// @new-code-test positive src/core/db-interface.ts
// @new-code-test negative src/core/db-interface.ts
// @new-code-test positive src/core/db-postgres.ts
// @new-code-test negative src/core/db-postgres.ts
import { afterAll, beforeAll, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { mountPostgrestRoutes } from '~/apis/postgrest'
import { PostgresDatabase } from '~/core/db-postgres'
import { requirePostgres } from '../harness'

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
  CREATE TABLE IF NOT EXISTS column_grant_progress (id text PRIMARY KEY, owner_id text, phase text, frozen_payload text);
  CREATE TABLE IF NOT EXISTS column_grant_notes (id text PRIMARY KEY, progress_id text REFERENCES column_grant_progress(id), note text, frozen_note text);
  TRUNCATE column_grant_notes, column_grant_progress;
  ALTER TABLE column_grant_progress ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS owner_read ON column_grant_progress;
  CREATE POLICY owner_read ON column_grant_progress FOR SELECT TO authenticated USING(owner_id=current_setting('request.jwt.claim.sub',true));
  REVOKE ALL ON column_grant_progress FROM PUBLIC, authenticated, anon;
  GRANT SELECT(id,phase) ON column_grant_progress TO authenticated;
  INSERT INTO column_grant_progress VALUES ('mine','owner-a','complete','private-frozen-input'),('other','owner-b','pending','private-other-input');
  ALTER TABLE column_grant_notes ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS parent_read ON column_grant_notes;
  CREATE POLICY parent_read ON column_grant_notes FOR SELECT TO authenticated USING(EXISTS (SELECT 1 FROM column_grant_progress WHERE id=progress_id));
  REVOKE ALL ON column_grant_notes FROM PUBLIC, authenticated, anon;
  GRANT SELECT(id,progress_id,note) ON column_grant_notes TO authenticated;
  INSERT INTO column_grant_notes VALUES ('note-a','mine','public-note','private-note'),('note-b','other','other-note','private-other-note');
 `)
  app = new Elysia()
  mountPostgrestRoutes(app, db, (request) => ({
    role: request.headers.get('x-test-role') === 'anon' ? 'anon' : 'authenticated',
    userId: request.headers.get('x-test-user') ?? 'owner-a',
  }))
})
afterAll(async () => {
  await db
    ?.getPool()
    .query('DROP TABLE IF EXISTS column_grant_notes; DROP TABLE IF EXISTS column_grant_progress')
  await db?.close()
})
it('reads granted progress columns under owner RLS without selecting ungranted fields', async () => {
  const response = await app.handle(
    new Request('http://localhost/rest/v1/column_grant_progress?select=id,phase'),
  )
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual([{ id: 'mine', phase: 'complete' }])
})

for (const select of ['*', 'id,frozen_payload', 'leak:frozen_payload']) {
  it(`denies ungranted projection ${select}`, async () => {
    const response = await app.handle(
      new Request(`http://localhost/rest/v1/column_grant_progress?select=${select}`),
    )
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(await response.text()).not.toContain('private-frozen-input')
  })
}
it('preserves owner RLS and anonymous denial', async () => {
  for (const owner of ['owner-b', 'outsider']) {
    const response = await app.handle(
      new Request('http://localhost/rest/v1/column_grant_progress?select=id,phase', {
        headers: { 'x-test-user': owner },
      }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(
      owner === 'owner-b' ? [{ id: 'other', phase: 'pending' }] : [],
    )
  }
  const anonymous = await app.handle(
    new Request('http://localhost/rest/v1/column_grant_progress?select=id,phase', {
      headers: { 'x-test-role': 'anon' },
    }),
  )
  expect(anonymous.status).toBeGreaterThanOrEqual(400)
})
it('supports aliases, ordering and exact counts without reading ungranted values', async () => {
  const response = await app.handle(
    new Request(
      'http://localhost/rest/v1/column_grant_progress?select=progress:id,phase&limit=1&offset=0&order=id.asc&or=(phase.eq.complete,phase.eq.pending)',
      { headers: { prefer: 'count=exact' } },
    ),
  )
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual([{ progress: 'mine', phase: 'complete' }])
  expect(response.headers.get('content-range')).toContain('/1')
  const head = await app.handle(
    new Request(
      'http://localhost/rest/v1/column_grant_progress?or=(phase.eq.complete,phase.eq.pending)',
      { method: 'HEAD', headers: { prefer: 'count=exact' } },
    ),
  )
  expect(head.status).toBe(200)
  expect(head.headers.get('content-range')).toBe('*/1')
})
it('denies predicates and ordering on ungranted columns', async () => {
  for (const suffix of ['&frozen_payload=eq.private-frozen-input', '&order=frozen_payload.asc']) {
    const response = await app.handle(
      new Request(`http://localhost/rest/v1/column_grant_progress?select=id${suffix}`),
    )
    expect(response.status).toBeGreaterThanOrEqual(400)
  }
})
it('projects nested reads without exposing extra join fields or protected columns', async () => {
  const inbound = await app.handle(
    new Request(
      'http://localhost/rest/v1/column_grant_progress?select=phase,notes:column_grant_notes(note)',
    ),
  )
  expect(inbound.status).toBe(200)
  expect(await inbound.json()).toEqual([{ phase: 'complete', notes: [{ note: 'public-note' }] }])
  const outbound = await app.handle(
    new Request(
      'http://localhost/rest/v1/column_grant_notes?select=note,progress:progress_id(phase)',
    ),
  )
  expect(outbound.status).toBe(200)
  expect(await outbound.json()).toEqual([{ note: 'public-note', progress: { phase: 'complete' } }])
  const denied = await app.handle(
    new Request(
      'http://localhost/rest/v1/column_grant_progress?select=id,notes:column_grant_notes(frozen_note)',
    ),
  )
  expect(denied.status).toBeGreaterThanOrEqual(400)
  expect(await denied.text()).not.toContain('private-note')
})
