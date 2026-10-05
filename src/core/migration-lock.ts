/** Narrow pool surface used by the startup migration lock. */
export interface MigrationLockClient {
  query(sql: string): Promise<unknown>
  release(destroy?: boolean): void
}

export interface MigrationLockPool {
  connect(): Promise<MigrationLockClient>
}

type LockOutcome<T> = { ok: true; value: T } | { ok: false; error: unknown }

function combineUnlockFailure<T>(outcome: LockOutcome<T>, error: unknown): LockOutcome<T> {
  if (outcome.ok) return { ok: false, error }
  return {
    ok: false,
    error: new AggregateError([outcome.error, error], 'Migration and lock release failed'),
  }
}

/**
 * Serialize migration discovery, execution, and ledger writes across replicas.
 * A dedicated connection holds the session lock throughout `run`.
 */
export async function withPostgresMigrationLock<T>(
  pool: MigrationLockPool,
  run: () => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  let acquired = false
  let destroy = false
  let outcome: LockOutcome<T>
  try {
    await client.query('SELECT pg_advisory_lock(732031, 1)')
    acquired = true
    outcome = { ok: true, value: await run() }
  } catch (error) {
    if (!acquired) destroy = true
    outcome = { ok: false, error }
  }
  try {
    if (acquired) await client.query('SELECT pg_advisory_unlock(732031, 1)')
  } catch (error) {
    destroy = true
    outcome = combineUnlockFailure(outcome, error)
  } finally {
    client.release(destroy)
  }
  if (!outcome.ok) throw outcome.error
  return outcome.value
}
