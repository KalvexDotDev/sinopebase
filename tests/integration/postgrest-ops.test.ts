/**
 * PostgREST Ops ATDD Tests — full server (SDK → HTTP → server → PostgreSQL)
 *
 * Covers the gaps found by the codex audit:
 *   1. upsert (Prefer: resolution=merge-duplicates) vs plain insert on conflict
 *   2. contains / containedBy / not / textSearch filters
 *   3. range(from, to) pagination
 *   4. single / maybeSingle row-shape errors (PGRST116)
 *   5. HEAD + exact count
 *
 * These tests run against a real PostgreSQL instance via TEST_POSTGRES_URL.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Sinopebase } from '../../src/core/app'
import { PostgresDatabase } from '../../src/core/db-postgres'
import { createClient, type SinopebaseClient } from '../../src/sdk/client'
import { requirePostgres, reserveLoopbackPort } from '../harness'
import { uniqueId } from './setup'

const TABLE = 'pgrest_ops_test'

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

beforeAll(async () => {
  const portReservation = await reserveLoopbackPort()
  anonKey = 'pgrest-ops-anon-key-min-32-chars!!!!'
  serviceRoleKey = 'pgrest-ops-srvc-key-min-32-chars!!!'

  // Create the dedicated test table (roles + grants + TRUNCATE for idempotency).
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
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id text PRIMARY KEY,
      title text NOT NULL DEFAULT '',
      score integer NOT NULL DEFAULT 0,
      tags jsonb NOT NULL DEFAULT '[]'::jsonb
    );
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    GRANT SELECT ON ${TABLE} TO anon;
    GRANT ALL ON ${TABLE} TO service_role;
    TRUNCATE ${TABLE};
  `)

  server = new Sinopebase({
    postgresUrl: requirePostgres(),
    port: portReservation.port,
    jwtSecret: 'pgrest-ops-test-jwt-secret-min-32-char',
    serviceRoleKey: serviceRoleKey,
    anonKey: anonKey,
  })
  await portReservation.release()
  await server.start()

  baseUrl = portReservation.origin
  client = createClient(baseUrl, anonKey)
  serviceClient = createClient(baseUrl, serviceRoleKey)
})

afterAll(async () => {
  await server.stop()
  await db.close()
})

// ---------------------------------------------------------------------------
// Upsert — Prefer: resolution=merge-duplicates
// ---------------------------------------------------------------------------

describe('PostgREST upsert', () => {
  it('upsert: true merges the row on primary-key conflict', async () => {
    const marker = uniqueId()
    const id = `up-${marker}`

    // Seed the original row
    const { error: seedError } = await serviceClient
      .from(TABLE)
      .insert({ id, title: 'original-title', score: 1 })
    expect(seedError).toBeNull()

    // Upsert on the same primary key must merge, not fail
    const { error: upsertError } = await serviceClient
      .from(TABLE)
      .insert({ id, title: 'merged-title', score: 2 }, { upsert: true })
    expect(upsertError).toBeNull()

    // Verify the old row was updated in place
    const { data, error } = await client.from(TABLE).select('*').eq('id', id).single()
    expect(error).toBeNull()
    expect(data?.title).toBe('merged-title')
    expect(data?.score).toBe(2)

    // Cleanup
    await serviceClient.from(TABLE).delete().eq('id', id)
  })

  it('plain insert on primary-key conflict returns an error and keeps the original row', async () => {
    const marker = uniqueId()
    const id = `dup-${marker}`

    const { error: firstError } = await serviceClient
      .from(TABLE)
      .insert({ id, title: 'first-writer', score: 1 })
    expect(firstError).toBeNull()

    // Same primary key without upsert must not silently overwrite
    const { error: conflictError } = await serviceClient
      .from(TABLE)
      .insert({ id, title: 'second-writer', score: 2 })
    expect(conflictError).not.toBeNull()

    // The original row must be untouched and unique
    const { data, error } = await client.from(TABLE).select('*').eq('id', id)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data?.[0]?.title).toBe('first-writer')
    expect(data?.[0]?.score).toBe(1)

    // Cleanup
    await serviceClient.from(TABLE).delete().eq('id', id)
  })
})

// ---------------------------------------------------------------------------
// Filters — contains / containedBy / not / textSearch
// ---------------------------------------------------------------------------

describe('PostgREST advanced filters', () => {
  const seedRow = async (row: Record<string, unknown>): Promise<void> => {
    const { error } = await serviceClient.from(TABLE).insert(row)
    expect(error).toBeNull()
  }

  it('contains — jsonb containment matches rows whose tags hold the value', async () => {
    const marker = `ct-${uniqueId()}`
    await seedRow({
      id: `${marker}-t1`,
      title: marker,
      score: 1,
      tags: { color: 'blue', size: 'm' },
    })
    await seedRow({ id: `${marker}-t2`, title: marker, score: 2, tags: { color: 'red' } })
    // ponytail: the SDK serializes JS arrays as PostgreSQL array literals, so a
    // jsonb array row cannot be inserted through the SDK (invalid jsonb → 500).
    // Seed the array-form row via the pool and cover the server path directly.
    await db
      .getPool()
      .query(`INSERT INTO ${TABLE} (id, title, score, tags) VALUES ($1, $2, $3, $4::jsonb)`, [
        `${marker}-a3`,
        marker,
        3,
        '["blue","m"]',
      ])

    // ponytail: SDK contains() double-encodes the JSON filter value
    // (encodeURIComponent + URLSearchParams), the server decodes once, and the
    // filter reaches PostgreSQL URL-encoded → invalid jsonb → 500. Use the raw
    // HTTP path so this test pins the server-side operator end to end. The SDK
    // encoding bug is tracked separately.
    const csObject = encodeURIComponent('{"color":"blue"}')
    const csArray = encodeURIComponent('["blue"]')

    const objectResponse = await fetch(
      `${baseUrl}/rest/v1/${TABLE}?title=eq.${marker}&tags=cs.${csObject}`,
      { headers: { authorization: `Bearer ${anonKey}` } },
    )
    expect(objectResponse.status).toBe(200)
    const objectRows = (await objectResponse.json()) as { id: string }[]
    expect(objectRows.map((row) => row.id)).toEqual([`${marker}-t1`])

    const arrayResponse = await fetch(
      `${baseUrl}/rest/v1/${TABLE}?title=eq.${marker}&tags=cs.${csArray}`,
      { headers: { authorization: `Bearer ${anonKey}` } },
    )
    expect(arrayResponse.status).toBe(200)
    const arrayRows = (await arrayResponse.json()) as { id: string }[]
    expect(arrayRows.map((row) => row.id)).toEqual([`${marker}-a3`])
  })

  it('containedBy — jsonb containment matches rows contained by the value', async () => {
    const marker = `cd-${uniqueId()}`
    await seedRow({
      id: `${marker}-t1`,
      title: marker,
      score: 1,
      tags: { color: 'blue', size: 'm' },
    })
    await seedRow({ id: `${marker}-t2`, title: marker, score: 2, tags: { color: 'red' } })

    // Superset of t1 only: t2's color is absent, so t2 must not match.
    // ponytail: raw HTTP path — see the contains() test for the SDK encoding bug.
    const cdValue = encodeURIComponent('{"color":"blue","size":"m","extra":"x"}')
    const response = await fetch(
      `${baseUrl}/rest/v1/${TABLE}?title=eq.${marker}&tags=cd.${cdValue}`,
      { headers: { authorization: `Bearer ${anonKey}` } },
    )
    expect(response.status).toBe(200)
    const rows = (await response.json()) as { id: string }[]
    expect(rows.map((row) => row.id)).toEqual([`${marker}-t1`])
  })

  it('not — negates a filter', async () => {
    const marker = `nt-${uniqueId()}`
    await seedRow({ id: `${marker}-keep-a`, title: 'keep-a', score: 1 })
    await seedRow({ id: `${marker}-keep-b`, title: 'keep-b', score: 2 })
    await seedRow({ id: `${marker}-skip-me`, title: 'skip-me', score: 3 })

    const { data, error } = await client.from(TABLE).select('title').not('title', 'eq', 'skip-me')

    expect(error).toBeNull()
    const titles = (data ?? []).map((row) => row.title as string)
    expect(titles).not.toContain('skip-me')
    expect(titles).toContain('keep-a')
    expect(titles).toContain('keep-b')
  })

  it('textSearch — full-text search on a text column', async () => {
    const marker = `fts-${uniqueId()}`
    await seedRow({
      id: `${marker}-fox`,
      title: 'the quick brown fox jumps over the lazy dog',
      score: 1,
    })
    await seedRow({ id: `${marker}-unrelated`, title: 'completely unrelated content', score: 2 })

    const { data, error } = await client.from(TABLE).select('id').textSearch('title', 'quick')

    expect(error).toBeNull()
    const ids = (data ?? []).map((row) => row.id as string)
    expect(ids).toContain(`${marker}-fox`)
    expect(ids).not.toContain(`${marker}-unrelated`)
  })
})

// ---------------------------------------------------------------------------
// Range — header-based pagination
// ---------------------------------------------------------------------------

describe('PostgREST range', () => {
  it('range(from, to) returns exactly the requested slice', async () => {
    const marker = `rg-${uniqueId()}`
    const rows = Array.from({ length: 10 }, (_, index) => ({
      id: `${marker}-${index}`,
      title: marker,
      score: index,
    }))
    const { error: seedError } = await serviceClient.from(TABLE).insert(rows)
    expect(seedError).toBeNull()

    const { data, error } = await client
      .from(TABLE)
      .select('score')
      .eq('title', marker)
      .order('score', { ascending: true })
      .range(2, 5)

    expect(error).toBeNull()
    const scores = (data ?? []).map((row) => row.score)
    // Inclusive slice: rows at positions 2..5 → scores 2,3,4,5
    expect(scores).toEqual([2, 3, 4, 5])
  })
})

// ---------------------------------------------------------------------------
// Single / maybeSingle — row-shape errors (PGRST116)
// ---------------------------------------------------------------------------

describe('PostgREST single row shape', () => {
  it('single() on zero rows returns a PGRST116 error', async () => {
    const { data, error } = await client
      .from(TABLE)
      .select('*')
      .eq('id', `no-such-id-${uniqueId()}`)
      .single()

    expect(data).toBeNull()
    expect(error).not.toBeNull()
    expect(error?.code).toBe('PGRST116')
  })

  it('single() on multiple rows returns a PGRST116 error', async () => {
    const marker = `multi-${uniqueId()}`
    const { error: seedError } = await serviceClient.from(TABLE).insert([
      { id: `${marker}-1`, title: marker, score: 1 },
      { id: `${marker}-2`, title: marker, score: 2 },
    ])
    expect(seedError).toBeNull()

    const { data, error } = await client.from(TABLE).select('*').eq('title', marker).single()

    expect(data).toBeNull()
    expect(error).not.toBeNull()
    expect(error?.code).toBe('PGRST116')
  })

  it('maybeSingle() on zero rows returns null data without an error', async () => {
    const { data, error } = await client
      .from(TABLE)
      .select('*')
      .eq('id', `no-such-id-${uniqueId()}`)
      .maybeSingle()

    expect(data).toBeNull()
    expect(error).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// HEAD + exact count
// ---------------------------------------------------------------------------

describe('PostgREST HEAD and count', () => {
  it('select with head: true and count: exact returns the count and null data', async () => {
    const marker = `head-${uniqueId()}`
    const { error: seedError } = await serviceClient.from(TABLE).insert([
      { id: `${marker}-1`, title: marker, score: 1 },
      { id: `${marker}-2`, title: marker, score: 2 },
      { id: `${marker}-3`, title: marker, score: 3 },
    ])
    expect(seedError).toBeNull()

    const { data, count, error } = await client
      .from(TABLE)
      .select('*', { count: 'exact', head: true })
      .eq('title', marker)

    expect(error).toBeNull()
    expect(data).toBeNull()
    expect(count).toBe(3)
  })
})
