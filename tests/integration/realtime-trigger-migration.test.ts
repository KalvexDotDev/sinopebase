import { expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { Client, Pool } from 'pg'
import { attachRealtimeTriggers } from '~/apis/realtime-pg-listener'
import { up as installNotificationFunction } from '../../migrations/1780000000_realtime_notify_trigger'
import { requirePostgres } from '../harness'

test('realtime trigger migration publishes small changes without blocking large writes', async () => {
  const baseUrl = new URL(requirePostgres())
  const databaseName = `sinope_notify_${randomUUID().replaceAll('-', '')}`
  const admin = new Pool({ connectionString: baseUrl.toString(), max: 1 })
  let pool: Pool | undefined
  let listener: Client | undefined
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`)
    baseUrl.pathname = `/${databaseName}`
    pool = new Pool({ connectionString: baseUrl.toString(), max: 2 })
    listener = new Client({ connectionString: baseUrl.toString() })
    await installNotificationFunction({
      raw: async (sql) => {
        await pool?.query(sql)
      },
    })
    await pool.query('CREATE TABLE signal_test (id text PRIMARY KEY, body text)')
    await attachRealtimeTriggers(pool, undefined, true)

    const messages: Record<string, unknown>[] = []
    listener.on('notification', (notification) => {
      if (notification.payload) messages.push(JSON.parse(notification.payload))
    })
    await listener.connect()
    await listener.query('LISTEN sinopebase_changes')

    await pool.query('INSERT INTO signal_test (id, body) VALUES ($1, $2)', ['small', 'hello'])
    const deadline = Date.now() + 2000
    while (messages.length === 0 && Date.now() < deadline) await Bun.sleep(10)
    expect(messages[0]).toMatchObject({
      table: 'signal_test',
      event: 'INSERT',
      new: { id: 'small', body: 'hello' },
    })

    await pool.query('INSERT INTO signal_test (id, body) VALUES ($1, $2)', [
      'large',
      'x'.repeat(9000),
    ])
    await Bun.sleep(50)
    expect(messages).toHaveLength(1)
    const large = await pool.query('SELECT id FROM signal_test WHERE id = $1', ['large'])
    expect(large.rows).toHaveLength(1)

    await pool.query('DELETE FROM signal_test WHERE id = $1', ['small'])
    const deleteDeadline = Date.now() + 2000
    while (messages.length < 2 && Date.now() < deleteDeadline) await Bun.sleep(10)
    expect(messages[1]).toMatchObject({
      table: 'signal_test',
      event: 'DELETE',
      old: { id: 'small', body: 'hello' },
    })
  } finally {
    await listener?.end().catch(() => {})
    await pool?.end().catch(() => {})
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
    await admin.end()
  }
})
