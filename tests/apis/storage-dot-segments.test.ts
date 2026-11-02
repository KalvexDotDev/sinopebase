/**
 * Storage dot-segment names cannot cross owner prefixes (sinope#1111).
 * @new-code-test positive src/apis/file.ts
 * @new-code-test negative src/apis/file.ts
 *
 * Applications such as Sinope key storage policies on an object's first name
 * segment. A name like `<A>/../<B>/b.txt` passes a policy written for `<A>`,
 * while the local file store resolves it to `<B>/b.txt`. Each user here owns
 * the prefix named after their user id, mirroring a tenant folder.
 *
 * Prerequisites: TEST_POSTGRES_URL (or POSTGRES_URL) points at PostgreSQL.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Sinopebase } from '../../src/core/app'
import { createClient } from '../../src/sdk/client'
import { createTestNamespace, requirePostgres, reserveLoopbackPort } from '../harness'

const postgresUrl = process.env.TEST_POSTGRES_URL ?? process.env.POSTGRES_URL
const describePostgres = postgresUrl ? describe : describe.skip

const namespace = createTestNamespace({ suiteId: 'storage-dot-segments' })
const TEST_JWT_SECRET = 'sinopebase-dot-segment-test-jwt-32-chars!!'
const TEST_SERVICE_ROLE_KEY = 'sinopebase-dot-segment-svc-role-key-32!!'
const TEST_ANON_KEY = 'sinopebase-dot-segment-anon-key-32-chars!'

interface Session {
  token: string
  prefix: string
}

describePostgres('Storage object names with dot segments', () => {
  let app: Sinopebase
  let baseUrl: string
  let dataDir: string
  let bucket: string
  let a: Session
  let b: Session

  async function session(label: string): Promise<Session> {
    const response = await fetch(`${baseUrl}/auth/v1/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `dot-${label}-${crypto.randomUUID()}@sinopebase.test`,
        password: 'password-test-123',
      }),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { access_token: string; user: { id: string } }
    return { token: body.access_token, prefix: body.user.id }
  }

  function storage(token: string, route: string, body: unknown, method = 'POST') {
    return fetch(`${baseUrl}/storage/v1${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: TEST_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  }

  const bTarget = () => `${b.prefix}/b.txt`
  const crossing = () => `${a.prefix}/../${b.prefix}/b.txt`
  // Read through B's own session, so the check holds for the local and S3 stores.
  const bBytes = async () => {
    const { data, error } = await createClient(baseUrl, b.token)
      .storage.from(bucket)
      .download(bTarget())
    expect(error).toBeNull()
    return data?.text()
  }

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'sinopebase-dot-segments-'))
    const port = await reserveLoopbackPort()
    app = new Sinopebase({
      postgresUrl: requirePostgres(),
      port: port.port,
      dataDir,
      jwtSecret: TEST_JWT_SECRET,
      serviceRoleKey: TEST_SERVICE_ROLE_KEY,
      anonKey: TEST_ANON_KEY,
    })
    await port.release()
    await app.start()
    baseUrl = port.origin
    a = await session('a')
    b = await session('b')
    bucket = namespace.storageBucket('priv')
    const admin = createClient(baseUrl, TEST_SERVICE_ROLE_KEY)
    expect((await admin.storage.createBucket(bucket, { public: false })).error).toBeNull()
    const upload = (session: Session, name: string, text: string) =>
      createClient(baseUrl, session.token)
        .storage.from(bucket)
        .upload(name, new Blob([text]))
    expect((await upload(b, bTarget(), 'tenant b')).error).toBeNull()
    expect((await upload(a, `${a.prefix}/x.txt`, 'tenant a')).error).toBeNull()
  })

  afterAll(async () => {
    await createClient(baseUrl, b.token).storage.from(bucket).remove([bTarget()])
    await createClient(baseUrl, a.token)
      .storage.from(bucket)
      .remove([`${a.prefix}/x.txt`])
    await app.stop()
    await rm(dataDir, { recursive: true, force: true })
  })

  it('rejects copy and move into another prefix and keeps its bytes', async () => {
    for (const route of ['/object/copy', '/object/move']) {
      const response = await storage(a.token, route, {
        bucket,
        from: `${a.prefix}/x.txt`,
        to: crossing(),
      })
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        statusCode: '400',
        error: 'InvalidKey',
        message: `Invalid key: ${crossing()}`,
      })
    }
    expect(await bBytes()).toBe('tenant b')
    const own = await createClient(baseUrl, a.token)
      .storage.from(bucket)
      .download(`${a.prefix}/x.txt`)
    expect(await own.data?.text()).toBe('tenant a')
  })

  it('rejects uploads whose name escapes or is empty within a prefix', async () => {
    // The URL parser collapses `<A>/../<B>` to `<B>`, which the owner policy denies.
    for (const name of [crossing(), `${a.prefix}//b.txt`]) {
      const response = await fetch(`${baseUrl}/storage/v1/object/${bucket}/${name}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${a.token}`, apikey: TEST_ANON_KEY, 'x-upsert': 'true' },
        body: 'overwrite',
      })
      expect(response.status).toBeGreaterThanOrEqual(400)
    }
    expect(await bBytes()).toBe('tenant b')
  })

  it('rejects deletion and signing through another prefix', async () => {
    const remove = await storage(a.token, `/object/${bucket}`, { prefixes: [crossing()] }, 'DELETE')
    expect(remove.status).toBe(400)
    const sign = await storage(a.token, `/object/sign/${bucket}`, { paths: [crossing()] })
    expect(sign.status).toBe(400)
    expect(await bBytes()).toBe('tenant b')
  })
})
