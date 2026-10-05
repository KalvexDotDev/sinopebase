import { expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pool } from 'pg'
import { Sinopebase } from '~/core/app'
import { requirePostgres, requireRustFS, reserveLoopbackPort } from '../harness'

// @new-code-test positive src/core/app.ts
// @new-code-test negative src/core/app.ts

test('single-instance settings stay available and update local configuration', async () => {
  const reservation = await reserveLoopbackPort()
  const dataDir = await mkdtemp(join(tmpdir(), 'sinope-settings-'))
  const serviceRoleKey = 'deployment-settings-service-key-32-chars'
  const app = new Sinopebase({
    mode: 'development',
    port: reservation.port,
    dataDir,
    serviceRoleKey,
    anonKey: 'deployment-settings-anon-key-32-chars',
    jwtSecret: 'deployment-settings-jwt-secret-32-chars',
  })
  await reservation.release()
  try {
    await app.start()
    const url = `${reservation.origin}/api/settings`
    const headers = { Authorization: `Bearer ${serviceRoleKey}` }
    const initial = await fetch(url, { headers })
    expect(initial.status).toBe(200)
    expect(await initial.json()).toMatchObject({ appName: 'Sinopebase', minPasswordLength: 8 })

    const updated = await fetch(url, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ appName: 'Configured', minPasswordLength: 12 }),
    })
    expect(updated.status).toBe(200)
    expect(await updated.json()).toMatchObject({ appName: 'Configured', minPasswordLength: 12 })
  } finally {
    await app.stop()
    await reservation.release()
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('replicated readiness requires the PostgreSQL notification listener', async () => {
  const postgresUrl = new URL(requirePostgres())
  const rustfs = requireRustFS()
  const admin = new Pool({ connectionString: postgresUrl.toString(), max: 1 })
  const databaseName = `sinope_ready_${randomUUID().replaceAll('-', '')}`
  const reservation = await reserveLoopbackPort()
  const dataDir = await mkdtemp(join(tmpdir(), 'sinope-replicated-'))
  let app: Sinopebase | undefined
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`)
    postgresUrl.pathname = `/${databaseName}`
    app = new Sinopebase({
      mode: 'development',
      port: reservation.port,
      dataDir,
      postgresUrl: postgresUrl.toString(),
      minioEndpoint: rustfs.endpoint,
      minioAccessKey: rustfs.accessKey,
      minioSecretKey: rustfs.secretKey,
      serviceRoleKey: 'deployment-replicated-service-key-32-chars',
      anonKey: 'deployment-replicated-anon-key-32-chars',
      jwtSecret: 'deployment-replicated-jwt-secret-32-chars',
      multiReplica: true,
      externalRateLimit: true,
      enablePgNotify: true,
    })
    await reservation.release()
    await app.start()
    const readyUrl = `${reservation.origin}/api/ready`
    expect((await fetch(readyUrl)).status).toBe(200)
    expect((await fetch(`${reservation.origin}/api/settings`)).status).toBe(501)
    expect((await fetch(`${reservation.origin}/api/functions/v1`)).status).toBe(501)

    const listener = (app as unknown as { _pgListener: { stop(): Promise<void> } })._pgListener
    await listener.stop()
    const unavailable = await fetch(readyUrl)
    expect(unavailable.status).toBe(503)
    expect(await unavailable.json()).toMatchObject({ status: 'not ready' })
    expect((await fetch(`${reservation.origin}/api/health`)).status).toBe(200)
  } finally {
    await app?.stop()
    await reservation.release()
    await rm(dataDir, { recursive: true, force: true })
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
    await admin.end()
  }
})
