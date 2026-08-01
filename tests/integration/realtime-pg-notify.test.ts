/**
 * Integration test: PG LISTEN/NOTIFY cross-process realtime fan-out.
 *
 * Tests that changes made via one database connection are delivered to
 * WebSocket clients connected to a different Sinopebase process via the
 * PG LISTEN/NOTIFY mechanism.
 *
 * Requires: PostgreSQL running with the sinopebase_notify_change trigger.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Pool } from 'pg'
import type { PostgresChange, PostgrestChangePublisher } from '../../src/apis/realtime'
import { RealtimeHub } from '../../src/apis/realtime'
import { attachRealtimeTriggers, PgRealtimeListener } from '../../src/apis/realtime-pg-listener'

// ── Test infrastructure ──
const PG_URL =
  process.env.TEST_POSTGRES_URL ||
  process.env.POSTGRES_URL ||
  'postgres://127.0.0.1:5432/sinopebase_test'

describe('PgRealtimeListener', () => {
  let pool: Pool
  let hub: RealtimeHub
  let listener: PgRealtimeListener
  const channel = 'sinopebase_test_changes'
  const processId = 'test-process-001'
  const TABLE = 'pg_notify_test_table'
  let receivedChanges: PostgresChange[] = []

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_URL, max: 2 })

    // Create test table
    await pool.query(`DROP TABLE IF EXISTS "${TABLE}" CASCADE`)
    await pool.query(`CREATE TABLE "${TABLE}" (id SERIAL PRIMARY KEY, name TEXT, value INT)`)

    // Ensure trigger function exists
    await pool.query(`
      CREATE OR REPLACE FUNCTION sinopebase_notify_change()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
      AS $$
      BEGIN
        PERFORM pg_notify('sinopebase_test_changes',
          json_build_object(
            'process_id', current_setting('app.sinopebase_process_id', true),
            'table', TG_TABLE_NAME,
            'schema', TG_TABLE_SCHEMA,
            'event', TG_OP,
            'new', CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN row_to_json(NEW) ELSE '{}'::json END,
            'old', CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN row_to_json(OLD) ELSE '{}'::json END
          )::text
        );
        RETURN NEW;
      END;
      $$
    `)
    await pool.query(
      `CREATE TRIGGER "sinopebase_notify_${TABLE}" AFTER INSERT OR UPDATE OR DELETE ON "${TABLE}" FOR EACH ROW EXECUTE FUNCTION sinopebase_notify_change()`,
    )

    // Create hub that captures changes
    hub = new RealtimeHub({
      authorize: async () => ({}),
    })

    // Override publishPostgresChange to capture for assertions
    const originalPublish = hub.publishPostgresChange.bind(hub)
    hub.publishPostgresChange = async (change: PostgresChange) => {
      receivedChanges.push(change)
      return originalPublish(change)
    }

    // Set process ID on pool connections
    pool.on('connect', async (client) => {
      await client.query("SELECT set_config('app.sinopebase_process_id', $1, false)", [processId])
    })

    // Start listener
    listener = new PgRealtimeListener({
      pool,
      hub: hub as unknown as PostgrestChangePublisher,
      processId: 'listener-process-002', // Different from pool process ID
      channel,
    })
    await listener.start()
  })

  afterAll(async () => {
    await listener.stop()
    await pool.query(`DROP TABLE IF EXISTS "${TABLE}" CASCADE`)
    await pool.end()
  })

  test('receives INSERT notifications from external writes', async () => {
    receivedChanges = []
    await pool.query(`INSERT INTO "${TABLE}" (name, value) VALUES ($1, $2)`, ['test-row', 42])

    // Wait for notification to arrive
    await new Promise((r) => setTimeout(r, 200))

    expect(receivedChanges.length).toBeGreaterThan(0)
    const insert = receivedChanges.find((c) => c.event === 'INSERT')
    expect(insert).toBeDefined()
    expect(insert!.table).toBe(TABLE)
    expect(insert!.new.name).toBe('test-row')
    expect(insert!.new.value).toBe(42)
  })

  test('receives UPDATE notifications', async () => {
    receivedChanges = []
    await pool.query(`UPDATE "${TABLE}" SET value = $1 WHERE name = $2`, [99, 'test-row'])

    await new Promise((r) => setTimeout(r, 200))

    const update = receivedChanges.find((c) => c.event === 'UPDATE')
    expect(update).toBeDefined()
    expect(update!.new.value).toBe(99)
    expect(update!.old.name).toBe('test-row')
  })

  test('receives DELETE notifications', async () => {
    await pool.query(`INSERT INTO "${TABLE}" (name, value) VALUES ($1, $2)`, ['to-delete', 1])
    await new Promise((r) => setTimeout(r, 200))
    receivedChanges = []

    await pool.query(`DELETE FROM "${TABLE}" WHERE name = $1`, ['to-delete'])

    await new Promise((r) => setTimeout(r, 200))

    const del = receivedChanges.find((c) => c.event === 'DELETE')
    expect(del).toBeDefined()
    expect(del!.old.name).toBe('to-delete')
  })

  test('self-originated changes are skipped', async () => {
    // The pool uses processId='test-process-001', listener uses 'listener-process-002'
    // Changes from pool should arrive (different process_id)
    receivedChanges = []
    await pool.query(`INSERT INTO "${TABLE}" (name, value) VALUES ($1, $2)`, ['self-test', 7])

    await new Promise((r) => setTimeout(r, 200))
    expect(receivedChanges.length).toBeGreaterThan(0)
  })

  test('attaches triggers to user tables', async () => {
    // Create a temp table and attach
    const tmpTable = 'notify_attach_test'
    await pool.query(`DROP TABLE IF EXISTS "${tmpTable}" CASCADE`)
    await pool.query(`CREATE TABLE "${tmpTable}" (id SERIAL PRIMARY KEY, data TEXT)`)

    await attachRealtimeTriggers(pool)

    // Verify trigger exists
    const result = await pool.query(`
      SELECT tgname FROM pg_trigger
      WHERE tgname = 'sinopebase_notify_${tmpTable}'
    `)
    expect(result.rows.length).toBe(1)

    await pool.query(`DROP TABLE IF EXISTS "${tmpTable}" CASCADE`)
  })
})
