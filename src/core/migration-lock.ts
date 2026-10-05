/** Narrow pool surface used by the startup migration lock. */
export interface MigrationLockClient {
  query(sql: string): Promise<unknown>
  release(destroy?: boolean): void
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'end', listener: () => void): unknown
  off(event: 'error', listener: (error: Error) => void): unknown
  off(event: 'end', listener: () => void): unknown
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

async function unlockHeldMigrationLock(
  client: MigrationLockClient,
  acquired: boolean,
  signal: AbortSignal,
): Promise<void> {
  if (acquired && !signal.aborted) await client.query('SELECT pg_advisory_unlock(732031, 1)')
}

/**
 * Serialize migration discovery, execution, and ledger writes across replicas.
 * A dedicated connection holds the session lock throughout `run`.
 */
export async function withPostgresMigrationLock<T>(
  pool: MigrationLockPool,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  const controller = new AbortController()
  const onError = (error: Error): void => controller.abort(error)
  const onEnd = (): void => controller.abort(new Error('Migration lock connection ended'))
  client.on('error', onError)
  client.on('end', onEnd)
  let acquired = false
  let destroy = false
  let outcome: LockOutcome<T>
  try {
    await client.query('SELECT pg_advisory_lock(732031, 1)')
    controller.signal.throwIfAborted()
    acquired = true
    const value = await run(controller.signal)
    controller.signal.throwIfAborted()
    outcome = { ok: true, value }
  } catch (error) {
    if (!acquired || controller.signal.aborted) destroy = true
    outcome = { ok: false, error }
  }
  try {
    await unlockHeldMigrationLock(client, acquired, controller.signal)
  } catch (error) {
    destroy = true
    outcome = combineUnlockFailure(outcome, error)
  } finally {
    client.off('error', onError)
    client.off('end', onEnd)
    client.release(destroy)
  }
  if (!outcome.ok) throw outcome.error
  return outcome.value
}
