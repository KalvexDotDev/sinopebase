/**
 * @new-code-test positive src/apis/storage-postgres.ts
 * @new-code-test negative src/apis/storage-postgres.ts
 * @new-code-test positive src/core/app.ts
 * @new-code-test negative src/core/app.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pool } from 'pg'
import { PostgresStorageAccessPolicy } from '../../src/apis/storage-postgres'
import { Sinopebase } from '../../src/core/app'
import { PostgresDatabase } from '../../src/core/db-postgres'
import { reserveLoopbackPort } from '../harness'

const postgresUrl =
  process.env.TEST_POSTGRES_URL || 'postgresql://sinopebase:sinopebase@127.0.0.1:5432/sinopebase'
const serviceKey = 'admin-journey-regression-service-role-key'
const anonKey = 'admin-journey-regression-anon-key-32'
const auth = { Authorization: `Bearer ${serviceKey}` }
const unique = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

describe('admin journey storage and log persistence', () => {
  let app: Sinopebase
  let origin: string
  let dataDir: string
  let pool: Pool

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'sinopebase-admin-regression-'))
    const reservation = await reserveLoopbackPort()
    origin = reservation.origin
    app = new Sinopebase({
      port: reservation.port,
      postgresUrl,
      serviceRoleKey: serviceKey,
      anonKey,
      jwtSecret: 'admin-journey-regression-jwt-secret-32',
      minioEndpoint: '',
      minioAccessKey: '',
      minioSecretKey: '',
      dataDir,
    })
    await reservation.release()
    await app.start()
    pool = new Pool({ connectionString: postgresUrl })
  })

  afterAll(async () => {
    await app?.stop()
    await pool?.end()
    if (dataDir) await rm(dataDir, { recursive: true, force: true })
  })

  it('rejects nonempty bucket deletion, then deletes an empty bucket and its metadata', async () => {
    const name = `admin-delete-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const create = await fetch(`${origin}/storage/v1/bucket`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    expect(create.status).toBe(200)

    try {
      const upload = await fetch(`${origin}/storage/v1/object/${name}/keep.txt`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'text/plain' },
        body: 'keep',
      })
      expect(upload.status).toBe(200)
      const occupied = await fetch(`${origin}/storage/v1/bucket/${name}`, {
        method: 'DELETE',
        headers: auth,
      })
      expect(occupied.status).toBe(409)
      expect(await occupied.json()).toEqual({
        statusCode: '409',
        error: '409',
        message: 'Bucket is not empty',
      })
      const stillThere = await pool.query('SELECT id FROM storage.buckets WHERE id = $1', [name])
      expect(stillThere.rows).toHaveLength(1)

      const remove = await fetch(`${origin}/storage/v1/object/${name}`, {
        method: 'DELETE',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: ['keep.txt'] }),
      })
      expect(remove.status).toBe(200)
      const deleted = await fetch(`${origin}/storage/v1/bucket/${name}`, {
        method: 'DELETE',
        headers: auth,
      })
      expect(deleted.status).toBe(200)
      expect(await deleted.json()).toEqual({ message: `Deleted bucket "${name}".` })
      const metadata = await pool.query('SELECT id FROM storage.buckets WHERE id = $1', [name])
      expect(metadata.rows).toHaveLength(0)
      const missing = await fetch(`${origin}/storage/v1/bucket/${name}`, {
        method: 'DELETE',
        headers: auth,
      })
      expect(missing.status).toBe(404)
      expect(await missing.json()).toEqual({
        statusCode: '404',
        error: '404',
        message: 'Bucket not found',
      })
    } finally {
      await fetch(`${origin}/storage/v1/object/${name}`, {
        method: 'DELETE',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: ['keep.txt'] }),
      })
      await fetch(`${origin}/storage/v1/bucket/${name}`, { method: 'DELETE', headers: auth })
    }
  })

  it('persists application requests without logging reads of the log viewer', async () => {
    const path = `/api/probe_${unique('log')}`
    const probe = await fetch(`${origin}${path}`)
    expect(probe.status).toBeGreaterThanOrEqual(400)
    for (let attempt = 0; attempt < 30; attempt++) {
      const result = await pool.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM _logs WHERE message = $1',
        [`GET ${path}`],
      )
      if (Number(result.rows[0]?.n ?? 0) > 0) break
      await Bun.sleep(50)
    }
    const saved = await pool.query<{ data: Record<string, unknown> }>(
      'SELECT data FROM _logs WHERE message = $1',
      [`GET ${path}`],
    )
    expect(saved.rows.length).toBeGreaterThan(0)
    expect(JSON.parse(String(saved.rows[0]?.data))).toEqual({
      method: 'GET',
      path,
      status: probe.status,
      duration_ms: expect.any(Number),
      request_id: expect.any(String),
    })

    const auditPath = `/storage/v1/bucket/${unique('audit')}`
    const audited = await fetch(`${origin}${auditPath}`, { headers: auth })
    expect(audited.status).toBeGreaterThanOrEqual(400)
    for (let attempt = 0; attempt < 30; attempt++) {
      const result = await pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM _logs WHERE message = $1 AND data::jsonb->>'path' = $2",
        ['audit:service_role', auditPath],
      )
      if (Number(result.rows[0]?.n ?? 0) > 0) break
      await Bun.sleep(50)
    }
    const auditLog = await pool.query<{ data: Record<string, unknown> }>(
      "SELECT data FROM _logs WHERE message = $1 AND data::jsonb->>'path' = $2",
      ['audit:service_role', auditPath],
    )
    expect(JSON.parse(String(auditLog.rows[0]?.data))).toEqual({
      method: 'GET',
      path: auditPath,
      status: audited.status,
      duration_ms: expect.any(Number),
      request_id: expect.any(String),
    })

    const countViewer = async () => {
      const result = await pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM _logs WHERE message = 'GET /api/logs'",
      )
      return Number(result.rows[0]?.n ?? 0)
    }
    const before = await countViewer()
    for (let i = 0; i < 3; i++) {
      const response = await fetch(`${origin}/api/logs`, { headers: auth })
      expect(response.status).toBe(200)
    }
    await Bun.sleep(100)
    expect(await countViewer()).toBe(before)
  }, 15_000)

  it('enforces metadata bucket deletion directly for each role and bucket state', async () => {
    const db = new PostgresDatabase({ postgresUrl, runtimeRole: '' })
    const policy = new PostgresStorageAccessPolicy(db)
    const name = `policy-delete-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    let persisted = 0
    const persist = async () => {
      persisted++
    }
    try {
      await expect(
        policy.deleteBucket({ role: 'authenticated', userId: 'member' }, name, persist),
      ).rejects.toMatchObject({
        status: 403,
        code: '403',
        message: 'Only service_role can delete buckets',
      })
      await expect(
        policy.deleteBucket({ role: 'service_role' }, name, persist),
      ).rejects.toMatchObject({ status: 404, code: '404', message: 'Bucket not found' })
      expect(persisted).toBe(0)

      await pool.query('INSERT INTO storage.buckets (id, name) VALUES ($1, $1)', [name])
      await pool.query('INSERT INTO storage.objects (bucket_id, name) VALUES ($1, $2)', [
        name,
        'keep.txt',
      ])
      await expect(
        policy.deleteBucket({ role: 'service_role' }, name, persist),
      ).rejects.toMatchObject({ status: 409, code: '409', message: 'Bucket is not empty' })
      expect(persisted).toBe(0)
      await pool.query('DELETE FROM storage.objects WHERE bucket_id = $1', [name])
      await policy.deleteBucket({ role: 'service_role' }, name, persist)
      expect(persisted).toBe(1)
      const deleted = await pool.query('SELECT id FROM storage.buckets WHERE id = $1', [name])
      expect(deleted.rows).toHaveLength(0)
    } finally {
      await pool.query('DELETE FROM storage.buckets WHERE id = $1', [name])
      await db.close()
    }
  })
})
