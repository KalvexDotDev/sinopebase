/**
 * PostgREST Embedded Relations ATDD — full server (SDK → HTTP → server → PostgreSQL)
 *
 * Closes the [P1] audit gap for feature 10: embedded resource selects must be
 * resolved from REAL PostgreSQL foreign-key metadata (pg_constraint), not
 * mocks, over the HTTP path.
 *
 * Tables:
 *   pgrest_rel_authors(id, name)
 *   pgrest_rel_books(id, title, author_id REFERENCES pgrest_rel_authors(id))
 *
 * Covered semantics (mirrors src/apis/postgrest.test.ts unit tests):
 *   1. outbound embed by FK column name  — select('*, author_id(*)')
 *   2. outbound embed by FK column as an alias — select('title, author:author_id(id, name)')
 *   3. inbound embed (one-to-many) as an array — select('id, books:pgrest_rel_books(id, title)')
 *   4. !inner filter drops parent rows without matches
 *   5. unknown relation name → structured error, not a silent flat result
 *
 * Embedding selectors resolve against the REAL table/column/constraint names
 * (e.g. 'pgrest_rel_books', 'author_id', 'pgrest_rel_books_author_id_fkey').
 *
 * These tests run against a real PostgreSQL instance via TEST_POSTGRES_URL.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Sinopebase } from '../../src/core/app'
import { PostgresDatabase } from '../../src/core/db-postgres'
import { createClient, type SinopebaseClient } from '../../src/sdk/client'
import { requirePostgres, reserveLoopbackPort } from '../harness'

const AUTHORS_TABLE = 'pgrest_rel_authors'
const BOOKS_TABLE = 'pgrest_rel_books'

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

let client: SinopebaseClient
let serviceClient: SinopebaseClient
let server: Sinopebase
let db: PostgresDatabase
let baseUrl: string
let anonKey: string
let serviceRoleKey: string

type AuthorRow = {
  id: string
  name: string
  books?: { id: string; title: string }[] | null
}

type BookRow = {
  id: string
  title: string
  author_id: { id: string; name: string } | null
  author?: { id: string; name: string } | null
}

beforeAll(async () => {
  const portReservation = await reserveLoopbackPort()
  anonKey = 'pgrest-rel-anon-key-min-32-chars!!!!'
  serviceRoleKey = 'pgrest-rel-srvc-key-min-32-chars!!!'

  // Create the dedicated test tables with a REAL foreign key (roles + grants +
  // TRUNCATE for idempotency — same pattern as the ops suite).
  db = new PostgresDatabase({ postgresUrl: requirePostgres() })
  await db.connect()
  const pool = db.getPool()
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
      END IF;
    END
    $$;
    GRANT anon, authenticated, service_role TO CURRENT_USER;
    CREATE TABLE IF NOT EXISTS ${AUTHORS_TABLE} (
      id text PRIMARY KEY,
      name text NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS ${BOOKS_TABLE} (
      id text PRIMARY KEY,
      title text NOT NULL DEFAULT '',
      author_id text REFERENCES ${AUTHORS_TABLE}(id)
    );
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    GRANT SELECT ON ${AUTHORS_TABLE} TO anon;
    GRANT ALL ON ${AUTHORS_TABLE} TO service_role;
    GRANT SELECT ON ${BOOKS_TABLE} TO anon;
    GRANT ALL ON ${BOOKS_TABLE} TO service_role;
    TRUNCATE ${AUTHORS_TABLE}, ${BOOKS_TABLE};
  `)

  server = new Sinopebase({
    postgresUrl: requirePostgres(),
    port: portReservation.port,
    jwtSecret: 'pgrest-rel-test-jwt-secret-min-32-char',
    serviceRoleKey: serviceRoleKey,
    anonKey: anonKey,
  })
  await portReservation.release()
  await server.start()

  baseUrl = portReservation.origin
  client = createClient(baseUrl, anonKey)
  serviceClient = createClient(baseUrl, serviceRoleKey)

  // Seed: three authors, four books (two for Ada, one for Alan, one orphaned).
  const { error: authorsError } = await serviceClient.from(AUTHORS_TABLE).insert([
    { id: 'rel-a1', name: 'Ada Lovelace' },
    { id: 'rel-a2', name: 'Alan Turing' },
    { id: 'rel-a3', name: 'Grace Hopper' },
  ])
  expect(authorsError).toBeNull()

  const { error: booksError } = await serviceClient.from(BOOKS_TABLE).insert([
    { id: 'rel-b1', title: 'Notes on the Analytical Engine', author_id: 'rel-a1' },
    { id: 'rel-b2', title: 'Sketch of the Analytical Engine', author_id: 'rel-a1' },
    { id: 'rel-b3', title: 'On Computable Numbers', author_id: 'rel-a2' },
    { id: 'rel-b4', title: 'Orphaned Manuscript', author_id: null },
  ])
  expect(booksError).toBeNull()
})

afterAll(async () => {
  await server.stop()
  await db.close()
})

// ---------------------------------------------------------------------------
// Outbound embeds — many-to-one (books.author_id → authors)
// ---------------------------------------------------------------------------

describe('PostgREST embedded relations — outbound', () => {
  it('select("*, author_id(*)") embeds the related author as a nested object', async () => {
    const { data, error } = await client
      .from<BookRow>(BOOKS_TABLE)
      .select('*, author_id(*)')
      .eq('id', 'rel-b1')
      .single()

    expect(error).toBeNull()
    // ponytail: the server projects the `*` columns first and then overwrites
    // the colliding `author_id` key with the embedded object, so the scalar FK
    // value is not present in the response.
    expect(data?.author_id).toEqual({ id: 'rel-a1', name: 'Ada Lovelace' })
  })

  it('embeds null when the foreign key is null', async () => {
    const { data, error } = await client
      .from<BookRow>(BOOKS_TABLE)
      .select('id, author:author_id(id, name)')
      .eq('id', 'rel-b4')
      .single()

    expect(error).toBeNull()
    expect(data?.id).toBe('rel-b4')
    expect(data?.author).toBeNull()
  })

  it('select("title, author:author_id(id, name)") resolves the FK column as an aliased embed', async () => {
    const { data, error } = await client
      .from<BookRow>(BOOKS_TABLE)
      .select('title, author:author_id(id, name)')
      .eq('id', 'rel-b3')
      .single()

    expect(error).toBeNull()
    expect(data?.title).toBe('On Computable Numbers')
    expect(data?.author).toEqual({ id: 'rel-a2', name: 'Alan Turing' })
  })
})

// ---------------------------------------------------------------------------
// Inbound embeds — one-to-many (authors ← books)
// ---------------------------------------------------------------------------

describe('PostgREST embedded relations — inbound', () => {
  it('select("id, books:pgrest_rel_books(id, title)") embeds the related rows as an array', async () => {
    const { data, error } = await client
      .from<AuthorRow>(AUTHORS_TABLE)
      .select('id, books:pgrest_rel_books(id, title)')
      .eq('id', 'rel-a1')
      .single()

    expect(error).toBeNull()
    const books = (data?.books ?? []).slice().sort((left, right) => left.id.localeCompare(right.id))
    expect(books).toEqual([
      { id: 'rel-b1', title: 'Notes on the Analytical Engine' },
      { id: 'rel-b2', title: 'Sketch of the Analytical Engine' },
    ])
  })

  it('embeds an empty array for a parent with no related rows', async () => {
    const { data, error } = await client
      .from<AuthorRow>(AUTHORS_TABLE)
      .select('id, books:pgrest_rel_books(id, title)')
      .eq('id', 'rel-a3')
      .single()

    expect(error).toBeNull()
    expect(data?.books).toEqual([])
  })

  it('select("id, books:pgrest_rel_books!inner(id, title)") drops parent rows without matches', async () => {
    const { data, error } = await client
      .from<AuthorRow>(AUTHORS_TABLE)
      .select('id, books:pgrest_rel_books!inner(id, title)')
      .order('id', { ascending: true })

    expect(error).toBeNull()
    const ids = (data ?? []).map((row) => row.id)
    // Grace Hopper has no books and must be filtered out by !inner.
    expect(ids).toEqual(['rel-a1', 'rel-a2'])
    expect((data ?? []).every((row) => (row.books ?? []).length > 0)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Unknown relations — must error, never return a silent flat result
// ---------------------------------------------------------------------------

describe('PostgREST embedded relations — unknown relation', () => {
  it('select("*, no_such_relation(*)") returns a structured 400 error', async () => {
    // A bad embed selector is a request error (PostgREST: PGRST204-class).
    // Error codes serialize as strings across all paths now.
    const response = await fetch(
      `${baseUrl}/rest/v1/${BOOKS_TABLE}?select=${encodeURIComponent('*, no_such_relation(*)')}`,
      { headers: { authorization: `Bearer ${anonKey}` } },
    )

    expect(response.status).toBe(400)
    const body = (await response.json()) as { code: unknown; message: string }
    expect(body.code).toBe('400')
    expect(body.message).toContain('No foreign-key relationship from')
    expect(body.message).toContain('no_such_relation')
  })
})
