/**
 * Bucket migrations ATDD — MIGRATIONS_BUCKET loads timestamped .sql files
 * from the file store at startup.
 *
 * Verifies a bucket-delivered migration that revokes PUBLIC EXECUTE on
 * functions actually applies, without recreating the database.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Sinopebase } from '~/core/app'
import type { PostgresDatabase } from '~/core/db-postgres'
import { createClient } from '~/sdk/client'
import { requirePostgres, reserveLoopbackPort } from '../harness'

const rootDir = join(tmpdir(), `sinopebase-bucket-migrations-${process.pid}`)
const dataDir = join(rootDir, 'data')
const bucket = 'test-migrations'
const anonKey = 'bucket-anon-key-min-32-chars!!!!!!'
const serviceRoleKey = 'bucket-srvc-key-min-32-chars!!!!!!'

let app: Sinopebase
let baseUrl: string

beforeAll(async () => {
  // LocalFileStore reads buckets from <dataDir>/storage/<bucket>/.
  mkdirSync(join(dataDir, 'storage', bucket), { recursive: true })
  writeFileSync(
    join(dataDir, 'storage', bucket, '1780000002_bucket_revoke_execute.sql'),
    `
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

CREATE OR REPLACE FUNCTION sinopebase_revoke_fn_execute()
RETURNS event_trigger LANGUAGE plpgsql AS $$
DECLARE
  obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands()
    WHERE command_tag = 'CREATE FUNCTION'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', obj.object_identity);
  END LOOP;
END;
$$;

DO $$
BEGIN
  BEGIN
    DROP EVENT TRIGGER IF EXISTS sinopebase_revoke_fn_execute;
    CREATE EVENT TRIGGER sinopebase_revoke_fn_execute
      ON ddl_command_end
      WHEN TAG IN ('CREATE FUNCTION')
      EXECUTE FUNCTION sinopebase_revoke_fn_execute();
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'sinopebase: not superuser — event trigger skipped';
  END;
END
$$;
`,
  )

  const portReservation = await reserveLoopbackPort()
  const prevBucket = process.env.MIGRATIONS_BUCKET
  process.env.MIGRATIONS_BUCKET = bucket
  app = new Sinopebase({
    postgresUrl: requirePostgres(),
    port: portReservation.port,
    dataDir,
    jwtSecret: 'bucket-jwt-secret-min-32-chars!!!',
    serviceRoleKey,
    anonKey,
  })
  try {
    await portReservation.release()
    await app.start()
  } finally {
    if (prevBucket === undefined) delete process.env.MIGRATIONS_BUCKET
    else process.env.MIGRATIONS_BUCKET = prevBucket
  }
  baseUrl = portReservation.origin
})

afterAll(async () => {
  await app.stop()
})

describe('bucket migrations', () => {
  it('applies .sql migrations from the configured bucket at startup', async () => {
    const appDb = app.getDatabase() as PostgresDatabase
    await appDb.getPool().query(`
      DROP FUNCTION IF EXISTS bucket_no_grant();
      CREATE FUNCTION bucket_no_grant() RETURNS integer
      LANGUAGE sql AS $$ SELECT 7 $$;
    `)

    const client = createClient(baseUrl, anonKey)
    const { data, error } = await client.rpc<number>('bucket_no_grant', {}, { get: true })

    // The bucket migration revoked PUBLIC EXECUTE, so this function has no
    // grant for anon — the call must fail (the server masks the internal
    // permission error as a 500).
    expect(data).toBeNull()
    expect(error?.code).toBe('500')
  })

  it('records the applied TypeScript migrations in the _migrations table', async () => {
    const appDb = app.getDatabase() as PostgresDatabase
    const { rows } = await appDb.getPool().query<{ name: string }>('SELECT name FROM _migrations')

    const names = rows.map((row) => row.name)
    // Both system migrations must have applied on this booted app. Their
    // names come from the migration filenames (see migrations_loader).
    expect(names).toContain('1779000000_least_privilege_roles')
    expect(names).toContain('1780000000_revoke_public_function_execute')
  })
})
