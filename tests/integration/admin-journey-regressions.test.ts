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
import { Sinopebase } from '../../src/core/app'
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
      const metadata = await pool.query('SELECT id FROM storage.buckets WHERE id = $1', [name])
      expect(metadata.rows).toHaveLength(0)
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
    const saved = await pool.query('SELECT id FROM _logs WHERE message = $1', [`GET ${path}`])
    expect(saved.rows.length).toBeGreaterThan(0)

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
  })
})
