/**
 * Auth session handling — setSession verifies tokens against the backend,
 * getSession clears stale in-memory sessions, and SSR cookie providers are
 * forwarded and persisted.
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { createAuthClient } from '~/sdk/auth-impl'
import type { CookieProvider } from '~/sdk/ssr'

const realFetch = globalThis.fetch

let cookieJar: { name: string; value: string }[] = []
let persisted: { name: string; value: string; opts?: Record<string, unknown> }[] = []

const provider: CookieProvider = {
  getAll: () => cookieJar,
  setAll: (cookies) => {
    persisted.push(...cookies)
    for (const c of cookies) {
      const existing = cookieJar.findIndex((x) => x.name === c.name)
      if (existing >= 0) cookieJar[existing] = { name: c.name, value: c.value }
      else cookieJar.push({ name: c.name, value: c.value })
    }
  },
}

const testUser = { id: 'u1', email: 'a@example.com' }

function stubJson(status: number, body: unknown, headers: Record<string, string> = {}): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), { status, headers })) as typeof fetch
}

afterEach(() => {
  globalThis.fetch = realFetch
  cookieJar = []
  persisted = []
})

describe('setSession', () => {
  it('rejects fabricated sessions without backend verification', async () => {
    stubJson(401, { message: 'Invalid token' })
    const auth = createAuthClient('http://x', 'key')

    const res = await auth.setSession({ access_token: 'fabricated', refresh_token: 'x' })

    expect(res.error?.status).toBe(401)
    expect(res.data.session).toBeNull()
    expect(await auth.getAccessToken()).toBeNull()
  })

  it('accepts valid tokens and takes the user from the verified response', async () => {
    stubJson(200, testUser)
    const auth = createAuthClient('http://x', 'key')

    const res = await auth.setSession({ access_token: 'good-token', refresh_token: 'r' })

    expect(res.error).toBeNull()
    expect(res.data.session?.user.id).toBe('u1')
    expect(await auth.getAccessToken()).toBe('good-token')
  })

  it('emits SIGNED_IN only after verification', async () => {
    const events: string[] = []
    stubJson(401, { message: 'no' })
    const auth = createAuthClient('http://x', 'key')
    auth.onAuthStateChange((event) => events.push(event))

    await auth.setSession({ access_token: 'bad', refresh_token: 'r' })

    expect(events).toEqual([])
  })
})

describe('getSession', () => {
  it('preserves the in-memory token when the server reports no cookie session', async () => {
    stubJson(200, testUser)
    const auth = createAuthClient('http://x', 'key')
    await auth.setSession({ access_token: 'good-token', refresh_token: 'r' })

    // The session route reads cookies only — a null session says nothing
    // about the Bearer-held in-memory session, which must survive.
    stubJson(200, { data: { session: null, user: null } })
    const res = await auth.getSession()

    expect(res.data.session).toBeNull()
    expect(await auth.getAccessToken()).toBe('good-token')
  })
})

describe('SSR cookie provider', () => {
  it('forwards the session cookie and persists set-cookie responses', async () => {
    cookieJar = [{ name: 'better-auth.session_token', value: 'cookie-secret' }]
    stubJson(
      200,
      {
        data: {
          session: { access_token: 'cookie-token', refresh_token: 'r', user: testUser },
          user: null,
        },
      },
      { 'set-cookie': 'better-auth.session_token=xyz; Path=/; HttpOnly' },
    )
    const auth = createAuthClient('http://x', 'key', provider)

    const res = await auth.getSession()

    expect(res.data.session?.access_token).toBe('cookie-token')
    expect(persisted.length).toBe(1)
    expect(persisted[0]?.name).toBe('better-auth.session_token')
    expect(persisted[0]?.value).toBe('xyz')
    expect(persisted[0]?.opts?.httpOnly).toBe(true)
  })

  it('getAccessToken probes the cookie session only once per client', async () => {
    cookieJar = [{ name: 'better-auth.session_token', value: 'cookie-secret' }]
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      return new Response(
        JSON.stringify({
          data: {
            session: { access_token: 'cookie-token', refresh_token: 'r', user: testUser },
            user: null,
          },
        }),
        { status: 200 },
      )
    }) as typeof fetch
    const auth = createAuthClient('http://x', 'key', provider)

    expect(await auth.getAccessToken()).toBe('cookie-token')
    expect(await auth.getAccessToken()).toBe('cookie-token')
    expect(calls).toBe(1)
  })
})
