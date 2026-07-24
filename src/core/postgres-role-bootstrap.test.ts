import { describe, expect, it } from 'bun:test'
import type { QueryResult } from 'pg'
import {
  bootstrapPostgresRequestRolesOnConnection,
  PostgresRoleBootstrapError,
  type PostgresRoleBootstrapClient,
} from './postgres-role-bootstrap'

type Role = {
  rolname: string
  rolcanlogin: boolean
  rolsuper: boolean
  rolcreatedb: boolean
  rolcreaterole: boolean
  rolreplication: boolean
  rolbypassrls: boolean
}

class FakeRoleClient implements PostgresRoleBootstrapClient {
  roles = new Map<string, Role>()
  memberships = new Set<string>()
  statements: string[] = []
  currentRole = 'sinope_owner'

  private canAdministerRoles: boolean

  constructor(canAdministerRoles = true) {
    this.canAdministerRoles = canAdministerRoles
  }

  async query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    _values?: unknown[],
  ): Promise<QueryResult<R>> {
    const normalized = text.replace(/\s+/g, ' ').trim()
    this.statements.push(normalized)

    if (normalized === 'SELECT current_user AS "connectionRole"') {
      return result([{ connectionRole: 'sinope_owner' }] as R[])
    }
    if (normalized.includes('FROM pg_roles') && normalized.includes('rolcanlogin')) {
      return result([...this.roles.values()] as R[])
    }
    if (normalized.startsWith('CREATE ROLE ')) {
      if (!this.canAdministerRoles) throw new Error('permission denied to create role')
      const name = normalized.split(' ')[2]!
      this.roles.set(name, safeRole(name))
      return result([])
    }
    if (normalized.includes("pg_has_role(current_user, target.oid, 'MEMBER')")) {
      return result([...this.roles.values()].map((role) => ({
        rolname: role.rolname,
        member: this.memberships.has(role.rolname),
      })) as R[])
    }
    if (normalized.startsWith('GRANT ')) {
      if (!this.canAdministerRoles) throw new Error('permission denied to grant role')
      const names = normalized.slice('GRANT '.length, normalized.indexOf(' TO CURRENT_USER'))
      for (const name of names.split(',').map((value) => value.trim())) this.memberships.add(name)
      return result([])
    }
    if (normalized.startsWith('SET LOCAL ROLE ')) {
      const name = normalized.slice('SET LOCAL ROLE '.length)
      if (!this.memberships.has(name)) throw new Error(`permission denied to set role "${name}"`)
      this.currentRole = name
      return result([])
    }
    if (normalized === 'SELECT current_role AS "currentRole"') {
      return result([{ currentRole: this.currentRole }] as R[])
    }
    if (normalized === 'RESET ROLE') {
      this.currentRole = 'sinope_owner'
      return result([])
    }
    if (normalized === 'ROLLBACK') this.currentRole = 'sinope_owner'
    return result([])
  }
}

describe('PostgreSQL request-role bootstrap', () => {
  it('creates safe roles, grants membership, and validates SET ROLE', async () => {
    const client = new FakeRoleClient()

    await bootstrapPostgresRequestRolesOnConnection(client)

    expect([...client.roles.keys()]).toEqual(['anon', 'authenticated', 'service_role'])
    expect([...client.memberships]).toEqual(['anon', 'authenticated', 'service_role'])
    expect(client.statements.filter((sql) => sql.startsWith('SET LOCAL ROLE '))).toEqual([
      'SET LOCAL ROLE anon',
      'SET LOCAL ROLE authenticated',
      'SET LOCAL ROLE service_role',
    ])
    expect(client.roles.get('service_role')?.rolbypassrls).toBe(true)
    expect(client.roles.get('authenticated')?.rolbypassrls).toBe(false)
  })

  it('is idempotent when roles and memberships are already valid', async () => {
    const client = new FakeRoleClient()
    for (const name of ['anon', 'authenticated', 'service_role']) {
      client.roles.set(name, safeRole(name))
      client.memberships.add(name)
    }

    await bootstrapPostgresRequestRolesOnConnection(client)
    await bootstrapPostgresRequestRolesOnConnection(client)

    expect(client.statements.some((sql) => sql.startsWith('CREATE ROLE '))).toBe(false)
    expect(client.statements.some((sql) => sql.startsWith('GRANT '))).toBe(false)
  })

  it('fails fast with an actionable diagnostic when role creation is forbidden', async () => {
    const client = new FakeRoleClient(false)

    await expect(bootstrapPostgresRequestRolesOnConnection(client)).rejects.toThrow(
      PostgresRoleBootstrapError,
    )
    await expect(bootstrapPostgresRequestRolesOnConnection(client)).rejects.toThrow(
      'Run startup once with a PostgreSQL administrator',
    )
    expect(client.statements).toContain('ROLLBACK')
  })

  it('refuses to silently repurpose an unsafe existing role', async () => {
    const client = new FakeRoleClient()
    client.roles.set('anon', { ...safeRole('anon'), rolcanlogin: true })

    await expect(bootstrapPostgresRequestRolesOnConnection(client)).rejects.toThrow(
      'Sinopebase did not alter this existing cluster-wide role',
    )
    expect(client.statements.some((sql) => sql.startsWith('CREATE ROLE '))).toBe(false)
  })
})

function safeRole(name: string): Role {
  return {
    rolname: name,
    rolcanlogin: false,
    rolsuper: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolreplication: false,
    rolbypassrls: name === 'service_role',
  }
}

function result<R extends Record<string, unknown>>(rows: R[]): QueryResult<R> {
  return {
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  }
}
