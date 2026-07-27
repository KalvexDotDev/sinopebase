/**
 * Storage Ownership RLS Tests
 *
 * Verifies that the per-object ownership RLS policies correctly enforce
 * owner-scoped access to storage.objects. Authenticated users can only
 * manage (read, update, delete) objects they own, while public bucket
 * objects remain readable by anyone (including anonymous users).
 *
 * Prerequisites:
 *   - TEST_POSTGRES_URL (or POSTGRES_URL) must point to a running PostgreSQL
 *   - SINOPEBASE_ANON_KEY and SINOPEBASE_SERVICE_ROLE_KEY must be set
 *   - The app's ensureMetadata() creates the auth.uid() function and RLS policies
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Sinopebase } from '../../src/core/app'
import { createClient } from '../../src/sdk/client'
import { createTestNamespace, requirePostgres, reserveLoopbackPort } from '../harness'

const postgresUrl = process.env.TEST_POSTGRES_URL ?? process.env.POSTGRES_URL
const describePostgres = postgresUrl ? describe : describe.skip

const namespace = createTestNamespace({ suiteId: 'storage-ownership-rls' })

/**
 * Test-only credentials that pass the app's startup key validation.
 * Must be >= 32 chars for JWT_SECRET, and non-default for keys.
 */
const TEST_JWT_SECRET = 'sinopebase-rls-ownership-test-jwt-32chars!!'
const TEST_SERVICE_ROLE_KEY = 'sinopebase-rls-ownership-svc-role-key-32!'
const TEST_ANON_KEY = 'sinopebase-rls-ownership-anon-key-32chars!'

describePostgres('Storage ownership RLS', () => {
  let app: Sinopebase
  let baseUrl: string
  let userAToken: string
  let userBToken: string
  let publicBucket: string
  let privateBucket: string

  beforeAll(async () => {
    requirePostgres()

    // Start the app — this calls ensureMetadata() which provisions the auth.uid()
    // function, storage schema, RLS policies, and the default test-bucket.
    const portReservation = await reserveLoopbackPort()
    app = new Sinopebase({
      postgresUrl: requirePostgres(),
      port: portReservation.port,
      jwtSecret: TEST_JWT_SECRET,
      serviceRoleKey: TEST_SERVICE_ROLE_KEY,
      anonKey: TEST_ANON_KEY,
    })
    await portReservation.release()
    await app.start()
    baseUrl = portReservation.origin

    // ── Create User A ──
    const emailA = `ownership-a-${Date.now()}@sinopebase.test`
    let respA = await fetch(`${baseUrl}/auth/v1/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailA, password: 'password-test-123' }),
    })
    if (respA.status === 400) {
      // User may already exist from a previous run; sign in instead.
      respA = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailA, password: 'password-test-123' }),
      })
    }
    const sessionA = (await respA.json()) as { access_token: string; user: { id: string } }
    userAToken = sessionA.access_token

    // ── Create User B ──
    const emailB = `ownership-b-${Date.now()}@sinopebase.test`
    let respB = await fetch(`${baseUrl}/auth/v1/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailB, password: 'password-test-123' }),
    })
    if (respB.status === 400) {
      respB = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailB, password: 'password-test-123' }),
      })
    }
    const sessionB = (await respB.json()) as { access_token: string; user: { id: string } }
    userBToken = sessionB.access_token

    // ── Create test buckets via service-role client ──
    const admin = createClient(baseUrl, TEST_SERVICE_ROLE_KEY)
    publicBucket = namespace.storageBucket('pub')
    await admin.storage.createBucket(publicBucket, { public: true })
    privateBucket = namespace.storageBucket('priv')
    await admin.storage.createBucket(privateBucket, { public: false })
  })

  afterAll(async () => {
    await app.stop()
  })

  // ────────────────────────────────────────────────────────────────────────────
  // Public bucket tests
  // ────────────────────────────────────────────────────────────────────────────

  describe('public bucket', () => {
    it('User A uploads and User B cannot delete', async () => {
      const clientA = createClient(baseUrl, userAToken)
      const clientB = createClient(baseUrl, userBToken)
      const path = `delete-test-${Date.now()}.txt`

      // User A uploads an object
      const { error: uploadErr } = await clientA.storage
        .from(publicBucket)
        .upload(path, new Blob(['user a content']), { upsert: true })
      expect(uploadErr).toBeNull()

      // User B tries to delete → RLS blocks, empty results
      const { data: deleteB, error: errB } = await clientB.storage.from(publicBucket).remove([path])
      expect(errB).toBeNull()
      expect(deleteB).toEqual([])

      // User A can delete their own object
      const { data: deleteA, error: errA } = await clientA.storage.from(publicBucket).remove([path])
      expect(errA).toBeNull()
      expect(deleteA?.length).toBe(1)
    })

    it('User B cannot overwrite (upsert) User A object', async () => {
      const clientA = createClient(baseUrl, userAToken)
      const clientB = createClient(baseUrl, userBToken)
      const path = `upsert-test-${Date.now()}.txt`

      // User A uploads
      const { error: uploadErr } = await clientA.storage
        .from(publicBucket)
        .upload(path, new Blob(['user a content']), { upsert: true })
      expect(uploadErr).toBeNull()

      // User B tries to upsert (overwrite) User A's object
      // The INSERT...ON CONFLICT DO UPDATE triggers the UPDATE RLS policy,
      // which checks owner_id = auth.uid()::text — User B is not the owner.
      const { error: upsertErr } = await clientB.storage
        .from(publicBucket)
        .upload(path, new Blob(['user b overwrite attempt']), { upsert: true })
      expect(upsertErr).not.toBeNull()

      // User A's original content is preserved
      const { data: downloadA } = await clientA.storage.from(publicBucket).download(path)
      const text = await (downloadA as Blob).text()
      expect(text).toBe('user a content')

      // Cleanup
      await clientA.storage.from(publicBucket).remove([path])
    })

    it('objects are readable by anyone (authenticated users and anon)', async () => {
      const clientA = createClient(baseUrl, userAToken)
      const clientB = createClient(baseUrl, userBToken)
      const anonClient = createClient(baseUrl, TEST_ANON_KEY)
      const path = `readable-${Date.now()}.txt`

      // User A uploads to public bucket
      await clientA.storage
        .from(publicBucket)
        .upload(path, new Blob(['anyone can read this']), { upsert: true })

      // User B can read (SELECT allows owner OR public bucket)
      const { data: listB } = await clientB.storage.from(publicBucket).list()
      expect(listB?.find((f) => f.name === path)).toBeTruthy()

      // Anon can read (anon SELECT policy allows public bucket objects)
      const { data: listAnon } = await anonClient.storage.from(publicBucket).list()
      expect(listAnon?.find((f) => f.name === path)).toBeTruthy()

      // Cleanup
      await clientA.storage.from(publicBucket).remove([path])
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // Private bucket tests
  // ────────────────────────────────────────────────────────────────────────────

  describe('private bucket', () => {
    it('User A can manage their own objects', async () => {
      const clientA = createClient(baseUrl, userAToken)
      const path = `self-manage-${Date.now()}.txt`

      // Upload → succeeds (INSERT WITH CHECK: owner_id = auth.uid())
      const { error: uploadErr } = await clientA.storage
        .from(privateBucket)
        .upload(path, new Blob(['self-owned']), { upsert: true })
      expect(uploadErr).toBeNull()

      // Read own object → succeeds
      const { data: listA } = await clientA.storage.from(privateBucket).list()
      expect(listA?.find((f) => f.name === path)).toBeTruthy()

      // Delete own object → succeeds
      const { data: deleteA } = await clientA.storage.from(privateBucket).remove([path])
      expect(deleteA?.length).toBe(1)
    })

    it('User B cannot read, update, or delete User A objects', async () => {
      const clientA = createClient(baseUrl, userAToken)
      const clientB = createClient(baseUrl, userBToken)
      const path = `cross-user-${Date.now()}.txt`

      // User A uploads to private bucket
      const { error: uploadErr } = await clientA.storage
        .from(privateBucket)
        .upload(path, new Blob(['secret data']), { upsert: true })
      expect(uploadErr).toBeNull()

      // User B lists → cannot see User A's object (SELECT policy blocks)
      const { data: listB } = await clientB.storage.from(privateBucket).list()
      expect(listB?.find((f) => f.name === path)).toBeFalsy()

      // User B downloads → fails (SELECT policy blocks)
      const { error: downloadErr } = await clientB.storage.from(privateBucket).download(path)
      expect(downloadErr).not.toBeNull()

      // User B deletes → empty results (DELETE policy blocks)
      const { data: deleteB } = await clientB.storage.from(privateBucket).remove([path])
      expect(deleteB).toEqual([])

      // User B upserts → fails (UPDATE policy blocks)
      const { error: upsertErr } = await clientB.storage
        .from(privateBucket)
        .upload(path, new Blob(['user b attempt']), { upsert: true })
      expect(upsertErr).not.toBeNull()

      // User A's original content is still intact
      const { data: downloadA } = await clientA.storage.from(privateBucket).download(path)
      const text = await (downloadA as Blob).text()
      expect(text).toBe('secret data')

      // Cleanup
      await clientA.storage.from(privateBucket).remove([path])
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // Anon access restriction tests
  // ────────────────────────────────────────────────────────────────────────────

  describe('anon access', () => {
    it('anon can read public bucket objects but not private bucket objects', async () => {
      const clientA = createClient(baseUrl, userAToken)
      const anonClient = createClient(baseUrl, TEST_ANON_KEY)
      const pubPath = `anon-pub-${Date.now()}.txt`
      const privPath = `anon-priv-${Date.now()}.txt`

      // User A uploads to both buckets
      await clientA.storage
        .from(publicBucket)
        .upload(pubPath, new Blob(['public file']), { upsert: true })
      await clientA.storage
        .from(privateBucket)
        .upload(privPath, new Blob(['private file']), { upsert: true })

      // Anon can list objects in public bucket
      const { data: pubList } = await anonClient.storage.from(publicBucket).list()
      expect(pubList?.find((f) => f.name === pubPath)).toBeTruthy()

      // Anon cannot list objects in private bucket (anon policy restricts to public buckets)
      const { data: privList } = await anonClient.storage.from(privateBucket).list()
      expect(privList?.find((f) => f.name === privPath)).toBeFalsy()

      // Anon can download from public bucket
      const { data: pubDownload } = await anonClient.storage.from(publicBucket).download(pubPath)
      expect(pubDownload).not.toBeNull()

      // Anon cannot download from private bucket (object not visible via anon SELECT policy)
      const { error: privDownloadErr } = await anonClient.storage
        .from(privateBucket)
        .download(privPath)
      expect(privDownloadErr).not.toBeNull()

      // Cleanup
      await clientA.storage.from(privateBucket).remove([privPath])
      await clientA.storage.from(publicBucket).remove([pubPath])
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // Concurrent isolation test
  // ────────────────────────────────────────────────────────────────────────────

  describe('isolation', () => {
    it('concurrent user operations are isolated from each other', async () => {
      const clientA = createClient(baseUrl, userAToken)
      const clientB = createClient(baseUrl, userBToken)
      const pathA = `isolate-a-${Date.now()}.txt`
      const pathB = `isolate-b-${Date.now()}.txt`

      // Both users upload simultaneously
      const [resultA, resultB] = await Promise.all([
        clientA.storage.from(privateBucket).upload(pathA, new Blob(['a']), { upsert: true }),
        clientB.storage.from(privateBucket).upload(pathB, new Blob(['b']), { upsert: true }),
      ])
      expect(resultA.error).toBeNull()
      expect(resultB.error).toBeNull()

      // Each user can only see their own objects
      const [listA, listB] = await Promise.all([
        clientA.storage.from(privateBucket).list(),
        clientB.storage.from(privateBucket).list(),
      ])
      expect(listA.data?.find((f) => f.name === pathA)).toBeTruthy()
      expect(listA.data?.find((f) => f.name === pathB)).toBeFalsy()
      expect(listB.data?.find((f) => f.name === pathB)).toBeTruthy()
      expect(listB.data?.find((f) => f.name === pathA)).toBeFalsy()

      // Cleanup
      await Promise.all([
        clientA.storage.from(privateBucket).remove([pathA]),
        clientB.storage.from(privateBucket).remove([pathB]),
      ])
    })
  })
})
