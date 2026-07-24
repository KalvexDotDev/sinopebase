import type { Pool, QueryResult } from 'pg'

const REQUEST_ROLES = ['anon', 'authenticated', 'service_role'] as const

type RequestRole = (typeof REQUEST_ROLES)[number]

interface RoleAttributes {
  rolname: string
  rolcanlogin: boolean
  rolsuper: boolean
  rolcreatedb: boolean
  rolcreaterole: boolean
  rolreplication: boolean
  rolbypassrls: boolean
  [key: string]: unknown
}

interface ConnectionRoleRow {
  connectionRole: string
  [key: string]: unknown
}

interface MembershipRow {
  rolname: string
  member: boolean
  [key: string]: unknown
}

interface CurrentRoleRow {
  currentRole: string
  [key: string]: unknown
}

export interface PostgresRoleBootstrapClient {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>
}

export class PostgresRoleBootstrapError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PostgresRoleBootstrapError'
  }
}

/**
 * Ensure the fixed PostgREST request roles exist and the configured login can
 * assume them. Role DDL is cluster-wide, so existing roles are validated and
 * never silently altered.
 */
export async function bootstrapPostgresRequestRoles(pool: Pool): Promise<void> {
  const client = await pool.connect()
  try {
    await bootstrapPostgresRequestRolesOnConnection(client)
  } finally {
    client.release()
  }
}

/** Exported for deterministic startup tests without a PostgreSQL cluster. */
export async function bootstrapPostgresRequestRolesOnConnection(
  client: PostgresRoleBootstrapClient,
): Promise<void> {
  let connectionRole = '<unknown>'

  await client.query('BEGIN')
  try {
    const identity = await client.query<ConnectionRoleRow>(
      'SELECT current_user AS "connectionRole"',
    )
    connectionRole = identity.rows[0]?.connectionRole ?? connectionRole

    const existing = await loadRequestRoles(client)
    for (const role of existing.values()) validateExistingRole(role)

    for (const role of REQUEST_ROLES) {
      if (!existing.has(role)) await client.query(createRoleStatement(role))
    }

    const memberships = await client.query<MembershipRow>(`
      SELECT target.rolname, pg_has_role(current_user, target.oid, 'MEMBER') AS member
      FROM pg_roles AS target
      WHERE target.rolname = ANY($1::text[])
    `, [[...REQUEST_ROLES]])
    const missingMemberships = memberships.rows
      .filter((row) => !row.member)
      .map((row) => row.rolname as RequestRole)

    if (missingMemberships.length > 0) {
      await client.query(
        `GRANT ${missingMemberships.join(', ')} TO CURRENT_USER`,
      )
    }

    for (const role of REQUEST_ROLES) await assertCanSetRole(client, role)

    await client.query('COMMIT')
  } catch (cause) {
    await client.query('ROLLBACK').catch(() => undefined)
    if (cause instanceof PostgresRoleBootstrapError) throw cause

    const detail = cause instanceof Error ? cause.message : String(cause)
    throw new PostgresRoleBootstrapError(
      `PostgreSQL request-role bootstrap failed for connection role "${connectionRole}": ${detail}. `
      + 'Sinopebase will not start without RLS role isolation. Run startup once with a PostgreSQL '
      + 'administrator, or provision NOLOGIN roles anon and authenticated plus a NOLOGIN BYPASSRLS '
      + `role service_role, then grant all three roles to "${connectionRole}".`,
      { cause },
    )
  }
}

async function loadRequestRoles(
  client: PostgresRoleBootstrapClient,
): Promise<Map<string, RoleAttributes>> {
  const result = await client.query<RoleAttributes>(`
    SELECT
      rolname,
      rolcanlogin,
      rolsuper,
      rolcreatedb,
      rolcreaterole,
      rolreplication,
      rolbypassrls
    FROM pg_roles
    WHERE rolname = ANY($1::text[])
  `, [[...REQUEST_ROLES]])
  return new Map(result.rows.map((role) => [role.rolname, role]))
}

function validateExistingRole(role: RoleAttributes): void {
  const expectedBypass = role.rolname === 'service_role'
  const unsafe = role.rolcanlogin
    || role.rolsuper
    || role.rolcreatedb
    || role.rolcreaterole
    || role.rolreplication
    || role.rolbypassrls !== expectedBypass

  if (unsafe) {
    throw new PostgresRoleBootstrapError(
      `PostgreSQL role "${role.rolname}" has incompatible security attributes. `
      + `Expected NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION ${expectedBypass ? 'BYPASSRLS' : 'NOBYPASSRLS'}. `
      + 'Sinopebase did not alter this existing cluster-wide role.',
    )
  }
}

function createRoleStatement(role: RequestRole): string {
  return `CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION ${role === 'service_role' ? 'BYPASSRLS' : 'NOBYPASSRLS'}`
}

async function assertCanSetRole(
  client: PostgresRoleBootstrapClient,
  role: RequestRole,
): Promise<void> {
  await client.query(`SET LOCAL ROLE ${role}`)
  const result = await client.query<CurrentRoleRow>(
    'SELECT current_role AS "currentRole"',
  )
  if (result.rows[0]?.currentRole !== role) {
    throw new Error(`SET ROLE validation selected "${result.rows[0]?.currentRole ?? '<unknown>'}" instead of "${role}"`)
  }
  await client.query('RESET ROLE')
}
