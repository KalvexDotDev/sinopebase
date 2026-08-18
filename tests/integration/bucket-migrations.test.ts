/**
 * Bucket migration lifecycle integration tests.
 *
 * These tests use real PostgreSQL and RustFS services. They exercise the same
 * S3-compatible path used by production deployments, including startup
 * ordering, the migration ledger, and fail-closed bucket discovery.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Client as MinioClient } from 'minio'
import { Pool } from 'pg'
import { Sinopebase } from '~/core/app'
import type { PostgresDatabase } from '~/core/db-postgres'
import { requirePostgres, requireRustFS, reserveLoopbackPort } from '../harness'

const postgresUrl = requirePostgres()
const rustfs = requireRustFS()
const runId = `${Date.now()}_${process.pid}`
const bucket = `migration-test-${process.pid}-${Date.now()}`
const tableName = `bucket_migration_${runId}`
const firstMigration = `${Date.now()}_create_bucket_migration_${runId}`
const secondMigration = `${Date.now() + 1}_alter_bucket_migration_${runId}`
const anonKey = 'bucket-anon-key-production-value-32-chars'
const serviceRoleKey = 'bucket-service-role-production-value-32-chars'
const jwtSecret = 'bucket-jwt-secret-production-value-32-chars'

function parseRustFSClient(): MinioClient {
  const url = new URL(rustfs.endpoint)
  return new MinioClient({
    endPoint: url.hostname,
    port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
    useSSL: url.protocol === 'https:',
    accessKey: rustfs.accessKey,
    secretKey: rustfs.secretKey,
  })
}

class ObservedSinopebase extends Sinopebase {
  runAllMigrationsCalls = 0
  runAppMigrationsCalls = 0

  override async runAllMigrations(): Promise<void> {
    this.runAllMigrationsCalls++
    await super.runAllMigrations()
  }

  override async runAppMigrations(): Promise<void> {
    this.runAppMigrationsCalls++
    await super.runAppMigrations()
  }
}

function createApp(port: number, overrides: Record<string, unknown> = {}): ObservedSinopebase {
  return new ObservedSinopebase({
    postgresUrl,
    port,
    mode: 'production',
    jwtSecret,
    serviceRoleKey,
    anonKey,
    minioEndpoint: rustfs.endpoint,
    minioAccessKey: rustfs.accessKey,
    minioSecretKey: rustfs.secretKey,
    ...overrides,
  })
}

async function startWithBucket(
  app: Sinopebase,
  migrationBucket: string | undefined,
): Promise<void> {
  const previous = process.env.MIGRATIONS_BUCKET
  try {
    if (migrationBucket === undefined) delete process.env.MIGRATIONS_BUCKET
    else process.env.MIGRATIONS_BUCKET = migrationBucket
    await app.start()
  } finally {
    if (previous === undefined) delete process.env.MIGRATIONS_BUCKET
    else process.env.MIGRATIONS_BUCKET = previous
  }
}

const s3 = parseRustFSClient()
const cleanupPool = new Pool({ connectionString: postgresUrl })

beforeAll(async () => {
  await s3.makeBucket(bucket)
  await s3.putObject(
    bucket,
    `${firstMigration}.sql`,
    Buffer.from(`
      CREATE TABLE public.${tableName} (
        id integer PRIMARY KEY,
        sequence integer NOT NULL
      );
      INSERT INTO public.${tableName} (id, sequence) VALUES (1, 1);
    `),
  )
  await s3.putObject(
    bucket,
    `${secondMigration}.sql`,
    Buffer.from(`
      ALTER TABLE public.${tableName} ADD COLUMN applied_by text;
      UPDATE public.${tableName} SET sequence = 2, applied_by = 'second';
    `),
  )
})

afterAll(async () => {
  await cleanupPool.query(`DROP TABLE IF EXISTS public.${tableName}`)
  await cleanupPool.query('DELETE FROM _migrations WHERE name = ANY($1)', [
    [firstMigration, secondMigration],
  ])
  await cleanupPool.end()
  await s3.removeObjects(bucket, [`${firstMigration}.sql`, `${secondMigration}.sql`])
  await s3.removeBucket(bucket)
})

describe('S3 bucket migrations during production startup', () => {
  it('lists, loads, orders, and applies timestamped SQL exactly once before listen', async () => {
    const reservation = await reserveLoopbackPort()
    const app = createApp(reservation.port)
    await reservation.release()

    try {
      await startWithBucket(app, bucket)

      expect(app.runAllMigrationsCalls).toBe(1)
      expect(app.runAppMigrationsCalls).toBe(1)

      const db = app.getDatabase() as PostgresDatabase
      const { rows } = await db
        .getPool()
        .query(`SELECT sequence, applied_by FROM public.${tableName} WHERE id = 1`)
      expect(rows).toEqual([{ sequence: 2, applied_by: 'second' }])

      const ledger = await db
        .getPool()
        .query<{ name: string }>(
          'SELECT name FROM _migrations WHERE name = ANY($1) ORDER BY applied_at, name',
          [[firstMigration, secondMigration]],
        )
      expect(ledger.rows.map((row) => row.name)).toEqual([firstMigration, secondMigration])
    } finally {
      await app.stop()
    }
  })

  it('uses the migration ledger to skip SQL that was already applied', async () => {
    const reservation = await reserveLoopbackPort()
    const app = createApp(reservation.port)
    await reservation.release()

    try {
      await startWithBucket(app, bucket)
      const db = app.getDatabase() as PostgresDatabase
      const result = await db
        .getPool()
        .query<{ count: string }>(`SELECT count(*)::text AS count FROM public.${tableName}`)
      expect(result.rows[0]?.count).toBe('1')
    } finally {
      await app.stop()
    }
  })

  it('fails production startup when the configured migration bucket cannot be listed', async () => {
    const reservation = await reserveLoopbackPort()
    const app = createApp(reservation.port)
    await reservation.release()

    try {
      await expect(startWithBucket(app, `${bucket}-missing`)).rejects.toThrow(
        /migration|bucket|S3/i,
      )
    } finally {
      await app.stop()
    }
  })

  it('retains existing startup behavior when MIGRATIONS_BUCKET is unset', async () => {
    const reservation = await reserveLoopbackPort()
    const app = createApp(reservation.port)
    await reservation.release()

    try {
      await startWithBucket(app, undefined)
      expect(app.runAllMigrationsCalls).toBe(1)
      expect(app.runAppMigrationsCalls).toBe(1)
    } finally {
      await app.stop()
    }
  })
})
