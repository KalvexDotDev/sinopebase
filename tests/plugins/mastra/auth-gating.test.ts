// ---------------------------------------------------------------------------
// Mastra AI — Auth gating & request-scoped context tests
//
// Two test groups:
//   1. AsyncLocalStorage unit tests (no HTTP needed)
//   2. HTTP auth gating via Elysia fetch() with mocked session lookup
// ---------------------------------------------------------------------------

import { beforeAll, describe, expect, it, mock } from 'bun:test'

// ---------------------------------------------------------------------------
// Mock lookupSessionByToken — must run before any import of auth-better
// ---------------------------------------------------------------------------

const MOCK_SESSION = {
  id: 'test-auth-user-id',
  email: 'test@sinopebase.dev',
  emailVerified: true,
  name: 'Test User',
  image: null,
  role: 'authenticated',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
}

const VALID_TOKEN = 'sinopebase-valid-test-token'

mock.module('~/tools/auth-better', () => ({
  lookupSessionByToken: async (_auth: unknown, token: string | null) => {
    if (token === VALID_TOKEN) return MOCK_SESSION
    return null
  },
}))

// ---------------------------------------------------------------------------
// Imports — after mock.module so auth-better resolves via the mock
// ---------------------------------------------------------------------------

import { Elysia } from 'elysia'
import type { AuthContext } from '~/plugins/mastra/plugin'
import {
  createAuthMiddleware,
  getCurrentRequestContext,
  withRequestContext,
} from '~/plugins/mastra/plugin'

// ---------------------------------------------------------------------------
// Group 1 — AsyncLocalStorage request-scoped context
// ---------------------------------------------------------------------------

describe('Mastra Auth — request-scoped context', () => {
  it('withRequestContext sets context visible to getCurrentRequestContext', () => {
    const ctx: AuthContext = { userId: 'u1', email: 'u1@test.com', role: 'admin' }
    const result = withRequestContext(ctx, () => getCurrentRequestContext())
    expect(result).toEqual(ctx)
  })

  it('getCurrentRequestContext returns null outside a context', () => {
    expect(getCurrentRequestContext()).toBeNull()
  })

  it('nested withRequestContext calls isolate correctly', async () => {
    const outer: AuthContext = { userId: 'outer', email: 'o@t.com', role: 'admin' }
    const inner: AuthContext = { userId: 'inner', email: 'i@t.com', role: 'user' }

    const result = await withRequestContext(outer, async () => {
      // Inside outer context
      const outerId = getCurrentRequestContext()?.userId

      // Spawn inner context — should not leak into outer
      const innerId = await withRequestContext(inner, async () => {
        return getCurrentRequestContext()?.userId
      })

      // After inner completes, outer context must be restored
      const afterInnerId = getCurrentRequestContext()?.userId

      return { outerId, innerId, afterInnerId }
    })

    expect(result.outerId).toBe('outer')
    expect(result.innerId).toBe('inner')
    expect(result.afterInnerId).toBe('outer')
  })

  it('concurrent in-flight requests do not leak context', async () => {
    const ctxA: AuthContext = { userId: 'user-a', email: 'a@test.com', role: 'admin' }
    const ctxB: AuthContext = { userId: 'user-b', email: 'b@test.com', role: 'user' }

    const [resultA, resultB] = await Promise.all([
      withRequestContext(ctxA, async () => {
        await new Promise((r) => setTimeout(r, 50))
        return getCurrentRequestContext()?.userId
      }),
      withRequestContext(ctxB, async () => {
        await new Promise((r) => setTimeout(r, 10))
        return getCurrentRequestContext()?.userId
      }),
    ])

    expect(resultA).toBe('user-a')
    expect(resultB).toBe('user-b')
  })
})

// ---------------------------------------------------------------------------
// Group 2 — HTTP auth gating via Elysia fetch()
// ---------------------------------------------------------------------------

describe('Mastra Auth — HTTP gating', () => {
  let app: Elysia

  beforeAll(() => {
    // Minimal Elysia app with auth middleware — use a truthy auth object so
    // validateAIRequest delegates to the mocked lookupSessionByToken.
    // Minimal Elysia app with auth middleware — cast through unknown because the
    // mock auth {} doesn't satisfy SinopebaseAuth's full generic type extension.
    app = (new Elysia() as unknown as Elysia)
      .use(
        createAuthMiddleware({} as unknown as import('~/tools/auth-better').SinopebaseAuth, true),
      )
      .post('/api/mastra/chat', async ({ request, set: _set }) => {
        const authCtx = (request as unknown as Record<string, unknown>).__authContext as
          | AuthContext
          | undefined

        const doHandle = async () => ({
          id: 'resp-1',
          choices: [{ message: { content: 'ok' } }],
        })

        if (authCtx) return withRequestContext(authCtx, doHandle)
        return doHandle()
      })
  })

  it('returns 401 for unauthenticated request (requireAuth=true)', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/mastra/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it('returns 401 for invalid Bearer token', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/mastra/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer this-is-bogus',
        },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it('returns 200 for valid Bearer token', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/mastra/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${VALID_TOKEN}`,
        },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }),
      }),
    )
    expect(res.status).toBe(200)
  })
})

// The real plugin's catalogue must share the inference authentication boundary.
describe('Mastra Auth — real agent catalogue', () => {
  it('denies catalogue access when no session adapter is available', async () => {
    const { MastraPlugin } = await import('~/plugins/mastra/plugin')
    const app = await new MastraPlugin({ requireAuth: true }).register(new Elysia())
    const response = await app.fetch(new Request('http://localhost/api/mastra/agents'))
    expect(response.status).toBe(401)
  })

  it('allows the explicitly configured service credential without a session adapter', async () => {
    const previous = process.env.SINOPEBASE_SERVICE_ROLE_KEY
    const serviceKey = 's'.repeat(64)
    try {
      process.env.SINOPEBASE_SERVICE_ROLE_KEY = serviceKey
      const { MastraPlugin } = await import('~/plugins/mastra/plugin')
      const app = await new MastraPlugin({ requireAuth: true }).register(new Elysia())
      const response = await app.fetch(
        new Request('http://localhost/api/mastra/agents', {
          headers: { Authorization: `Bearer ${serviceKey}` },
        }),
      )
      expect(response.status).toBe(200)
    } finally {
      if (previous === undefined) delete process.env.SINOPEBASE_SERVICE_ROLE_KEY
      else process.env.SINOPEBASE_SERVICE_ROLE_KEY = previous
    }
  })

  it.each([undefined, 'Bearer invalid-token'])(
    'rejects catalogue access with %s',
    async (authorization) => {
      const { MastraPlugin } = await import('~/plugins/mastra/plugin')
      const plugin = new MastraPlugin({ requireAuth: true })
      const app = await plugin.register(
        new Elysia(),
        {} as unknown as import('~/tools/auth-better').SinopebaseAuth,
      )
      const response = await app.fetch(
        new Request('http://localhost/api/mastra/agents', {
          headers: authorization ? { Authorization: authorization } : {},
        }),
      )
      expect(response.status).toBe(401)
      expect(await response.text()).not.toContain('instructions')
    },
  )

  it('retains catalogue access after token verification', async () => {
    const { MastraPlugin } = await import('~/plugins/mastra/plugin')
    const plugin = new MastraPlugin({ requireAuth: true })
    const app = await plugin.register(
      new Elysia(),
      {} as unknown as import('~/tools/auth-better').SinopebaseAuth,
    )
    const response = await app.fetch(
      new Request('http://localhost/api/mastra/agents', {
        headers: { Authorization: `Bearer ${VALID_TOKEN}` },
      }),
    )
    expect(response.status).toBe(200)
    expect((await response.json()).data.length).toBeGreaterThan(0)
  })
})

// Exercise the real provider routes, including streaming, before any inference can run.
describe('Mastra Auth — real inference routes', () => {
  const routes = [
    '/api/mastra/chat',
    '/api/mastra/chat/stream',
    '/api/mastra/embeddings',
    '/api/mastra/agents/default/chat',
    '/api/mastra/agents/default/stream',
  ]

  it.each(routes)('rejects absent and invalid credentials at %s', async (path) => {
    const { MastraPlugin } = await import('~/plugins/mastra/plugin')
    const plugin = new MastraPlugin({ requireAuth: true })
    const app = await plugin.register(
      new Elysia(),
      {} as unknown as import('~/tools/auth-better').SinopebaseAuth,
    )
    for (const authorization of [undefined, 'Bearer invalid-token']) {
      const response = await app.fetch(
        new Request(`http://localhost${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authorization ? { Authorization: authorization } : {}),
          },
          body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }], input: 'Hello' }),
        }),
      )
      expect(response.status).toBe(401)
      await response.body?.cancel()
    }
  })
})
