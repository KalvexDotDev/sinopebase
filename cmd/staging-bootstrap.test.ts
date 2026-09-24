import { describe, expect, test } from 'bun:test'
import type { PoolClient } from 'pg'
import { assertStagingTarget, checkState } from './staging-bootstrap'

const input = {
  databaseUrl:
    'postgres://operator:secret@pg-sinope-staging.postgres.database.azure.com/sinopebase?sslmode=require',
  azureResourceId:
    '/subscriptions/example/resourceGroups/rg-sinope-staging/providers/Microsoft.DBforPostgreSQL/flexibleServers/pg-sinope-staging',
  email: 'owner@example.test',
  tenantName: 'Fresh staging tenant',
}

function clientWith(rows: {
  identity?: object[]
  memberships?: object[]
  tenants?: object[]
}): PoolClient {
  return {
    query: async (statement: string) => {
      const selected = statement.includes('FROM public."user" u')
        ? (rows.identity ?? [])
        : statement.includes('FROM public.tenant_memberships m')
          ? (rows.memberships ?? [])
          : (rows.tenants ?? [])
      return { rows: selected, rowCount: selected.length }
    },
  } as unknown as PoolClient
}

const identity = {
  id: 'user-1',
  email: input.email,
  role: 'user',
  mirror_email: input.email,
  credential_count: '1',
}

describe('private staging bootstrap preflight', () => {
  test('requires the exact staging database host and TLS', () => {
    expect(() => assertStagingTarget(input)).not.toThrow()
    expect(() =>
      assertStagingTarget({ ...input, databaseUrl: input.databaseUrl.replace('staging', 'prod') }),
    ).toThrow()
    expect(() =>
      assertStagingTarget({
        ...input,
        databaseUrl: input.databaseUrl.replace('sslmode=require', 'sslmode=disable'),
      }),
    ).toThrow()
  })

  test('permits an empty staging database and a safe resume after identity creation', async () => {
    expect(await checkState(clientWith({}), input)).toEqual({ userId: null, complete: false })
    expect(await checkState(clientWith({ identity: [identity] }), input)).toEqual({
      userId: 'user-1',
      complete: false,
    })
  })

  test('rejects a tenant name collision or inconsistent identity mirror', async () => {
    await expect(
      checkState(clientWith({ tenants: [{ id: 'other-tenant' }] }), input),
    ).rejects.toThrow('already exists')
    await expect(
      checkState(
        clientWith({ identity: [{ ...identity, mirror_email: 'other@example.test' }] }),
        input,
      ),
    ).rejects.toThrow('does not match')
  })

  test('accepts only an already complete owner membership in the requested tenant', async () => {
    const complete = {
      tenant_id: 'tenant-1',
      name: input.tenantName,
      role: 'owner',
      profile_count: '1',
    }
    expect(
      await checkState(clientWith({ identity: [identity], memberships: [complete] }), input),
    ).toEqual({ userId: 'user-1', complete: true })
    await expect(
      checkState(
        clientWith({ identity: [identity], memberships: [{ ...complete, role: 'member' }] }),
        input,
      ),
    ).rejects.toThrow('does not match')
    await expect(
      checkState(clientWith({ identity: [identity], memberships: [complete, complete] }), input),
    ).rejects.toThrow('multiple')
  })
})
