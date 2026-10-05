import type { IDatabase } from '~/core/db-interface'
import type { MigrationLockClient } from '~/core/migration-lock'
import type { MigrationDB } from '../../migrations/types'

/** Keep migration statements and ledger reads on the lock-owning connection. */
export function createMigrationSession(
  client: MigrationLockClient,
  signal: AbortSignal,
): { ledger: Pick<IDatabase, 'hasTable' | 'select'>; sql: MigrationDB } {
  const query = async (
    statement: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }> => {
    signal.throwIfAborted()
    const result = (await client.query(statement, values)) as { rows: Record<string, unknown>[] }
    signal.throwIfAborted()
    return result
  }

  return {
    ledger: {
      async hasTable(table) {
        const result = await query(
          'SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1) AS present',
          [table],
        )
        return result.rows[0]?.present === true
      },
      async select(table) {
        const identifier = `"${table.replaceAll('"', '""')}"`
        return (await query(`SELECT * FROM ${identifier}`)).rows
      },
    },
    sql: {
      async raw(statement) {
        await query(statement)
      },
    },
  }
}
