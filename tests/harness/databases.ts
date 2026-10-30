/**
 * Per-test PostgreSQL databases.
 *
 * pg's `Pool.end()` resolves once its clients have sent Terminate, before the
 * server has closed those backends. `DROP DATABASE ... WITH (FORCE)` issued at
 * that moment terminates them, and the closing client surfaces 57P01
 * ("terminating connection due to administrator command") as an unhandled
 * error in whichever test runs next. Wait for the backends to leave first.
 */

interface AdminQuery {
  query<R extends Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }>
}

const DISCONNECT_POLL_MS = 20
const DISCONNECT_ATTEMPTS = 250

/** Drop a per-test database after every connection to it has closed. */
export async function dropTestDatabase(admin: AdminQuery, name: string): Promise<void> {
  for (let attempt = 0; attempt < DISCONNECT_ATTEMPTS; attempt++) {
    const { rows } = await admin.query<{ connected: number }>(
      'SELECT count(*)::int AS connected FROM pg_stat_activity WHERE datname = $1',
      [name],
    )
    if (rows[0]?.connected === 0) break
    await Bun.sleep(DISCONNECT_POLL_MS)
  }
  // FORCE only ends connections that outlived the wait, which a leak would cause.
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
}
