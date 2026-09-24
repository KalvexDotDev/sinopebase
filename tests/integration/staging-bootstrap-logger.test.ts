/**
 * @new-code-test positive src/tools/auth-better/index.ts
 * @new-code-test negative src/tools/auth-better/index.ts
 */
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { Pool } from 'pg'
import { createAuth } from '../../src/tools/auth-better'
import { requirePostgres } from '../harness'

describe('private bootstrap auth logging', () => {
  let pool: Pool

  beforeAll(() => {
    pool = new Pool({ connectionString: requirePostgres() })
  })

  afterAll(async () => {
    await pool.end()
  })

  test('does not log identifying database errors during failed identity creation', async () => {
    const auth = await createAuth(pool, { disableLogsForMaintenance: true })
    const context = await auth.$context
    const marker = 'private-bootstrap-identity-marker'
    const originalCreateUser = context.internalAdapter.createUser
    const errorLog = spyOn(console, 'error').mockImplementation(() => {})
    try {
      context.internalAdapter.createUser = async () => {
        throw new Error(marker)
      }
      await expect(
        auth.api.signUpEmail({
          body: {
            email: `${marker}@example.test`,
            password: 'synthetic-password-with-16-characters',
            name: '',
          },
        }),
      ).rejects.toThrow()
      expect(errorLog.mock.calls.flat().map(String).join(' ')).not.toContain(marker)
      expect(auth.options.logger).toEqual({ disabled: true })
    } finally {
      context.internalAdapter.createUser = originalCreateUser
      errorLog.mockRestore()
    }
  })

  test('keeps normal auth diagnostics enabled outside maintenance', async () => {
    const auth = await createAuth(pool)
    const context = await auth.$context
    const marker = 'synthetic-default-auth-error-marker'
    const originalCreateUser = context.internalAdapter.createUser
    const errorLog = spyOn(console, 'error').mockImplementation(() => {})
    try {
      context.internalAdapter.createUser = async () => {
        throw new Error(marker)
      }
      await expect(
        auth.api.signUpEmail({
          body: {
            email: `${marker}@example.test`,
            password: 'synthetic-password-with-16-characters',
            name: '',
          },
        }),
      ).rejects.toThrow()
      expect(errorLog.mock.calls.flat().map(String).join(' ')).toContain(marker)
      expect(auth.options.logger).toBeUndefined()
    } finally {
      context.internalAdapter.createUser = originalCreateUser
      errorLog.mockRestore()
    }
  })
})
