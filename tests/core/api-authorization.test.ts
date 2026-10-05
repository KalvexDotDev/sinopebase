// @new-code-test positive src/core/api-authorization.ts
// @new-code-test negative src/core/api-authorization.ts
import { expect, test } from 'bun:test'
import { authorizeApiRequest, requiresApiAuthorization } from '~/core/api-authorization'
import type { PostgresRequestContext } from '~/core/db-postgres'

const request = (path: string, method = 'GET', authorization?: string) =>
  new Request(`http://localhost${path}`, {
    method,
    headers: authorization ? { authorization } : {},
  })

test.each([
  ['/api/health', 'GET', false],
  ['/prefix/rest/v1/items', 'GET', false],
  ['/rest/v1/storage/v1/object/signed/token', 'GET', true],
  ['/rest/v1/items', 'OPTIONS', false],
  ['/storage/v1/object/public/bucket/file', 'GET', false],
  ['/storage/v1/object/signed/token', 'GET', false],
  ['/storage/v1/object/signed/token', 'POST', true],
  ['/storage/v1/object/signed/upload/token', 'GET', true],
  ['/storage/v1/object/signed/token/extra', 'GET', true],
  ['/storage/v1/object/sign/bucket/file', 'POST', true],
  ['/rest/v1/items', 'GET', true],
] as const)('authorization scope %s %s', (path, method, required) => {
  expect(requiresApiAuthorization(request(path, method))).toBe(required)
})

test.each([
  ['/storage/v1/object/bucket/file', 'POST', true],
  ['/rest/v1/rpc/example', 'POST', true],
  ['/rest/v1/rpc/example', 'DELETE', false],
  ['/rest/v1/items', 'GET', true],
  ['/rest/v1/items', 'HEAD', true],
  ['/rest/v1/items', 'POST', false],
  ['/rest/v1/items', 'DELETE', false],
] as const)('anonymous key permissions %s %s', async (path, method, allowed) => {
  const action = authorizeApiRequest(request(path, method, 'Bearer anonymous'), async () => ({
    role: 'anon',
  }))
  if (allowed) expect(await action).toEqual({ role: 'anon' })
  else await expect(action).rejects.toThrow('Invalid authorization token')
})

test.each(['service_role', 'authenticated'] as const)('keeps resolved %s context', async (role) => {
  const context: PostgresRequestContext = { role, userId: 'fixture' }
  const result = await authorizeApiRequest(
    request('/rest/v1/items', 'POST', 'raw-token'),
    async (token) => {
      expect(token).toBe('raw-token')
      return context
    },
  )
  expect(result).toEqual(context)
})

test.each([undefined, 'Bearer invalid'])(
  'rejects absent or invalid identity %s',
  async (authorization) => {
    await expect(
      authorizeApiRequest(request('/rest/v1/items', 'GET', authorization), async () => undefined),
    ).rejects.toThrow(authorization ? 'Invalid authorization token' : 'Authorization required')
  },
)
