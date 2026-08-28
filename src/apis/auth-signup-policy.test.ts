/**
 * @new-code-test positive src/apis/auth.ts
 * @new-code-test negative src/apis/auth.ts
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { authPlugin, createAuthPlugin, signupsAllowed } from './auth'

describe('signup policy', () => {
  const original = process.env.ALLOW_SIGNUPS
  const originalProduction = process.env.SINOPEBASE_PRODUCTION

  afterEach(() => {
    if (original === undefined) delete process.env.ALLOW_SIGNUPS
    else process.env.ALLOW_SIGNUPS = original
    if (originalProduction === undefined) delete process.env.SINOPEBASE_PRODUCTION
    else process.env.SINOPEBASE_PRODUCTION = originalProduction
  })

  it('allows local development by default', () => {
    delete process.env.ALLOW_SIGNUPS
    expect(signupsAllowed()).toBe(true)
  })

  it('closes direct signup when explicitly disabled', () => {
    process.env.ALLOW_SIGNUPS = 'false'
    expect(signupsAllowed()).toBe(false)
  })

  it('fails closed in production when the flag is absent', () => {
    process.env.SINOPEBASE_PRODUCTION = 'true'
    delete process.env.ALLOW_SIGNUPS
    expect(signupsAllowed()).toBe(false)
  })

  it('allows production signup only when explicitly enabled', () => {
    process.env.SINOPEBASE_PRODUCTION = 'true'
    process.env.ALLOW_SIGNUPS = 'true'
    expect(signupsAllowed()).toBe(true)
  })

  it('rejects signup through the in-memory route when production is closed', async () => {
    process.env.SINOPEBASE_PRODUCTION = 'true'
    delete process.env.ALLOW_SIGNUPS
    const response = await authPlugin.handle(
      new Request('http://localhost/auth/v1/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'blocked-memory@example.com', password: 'password-123' }),
      }),
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      message: 'Signups are currently invite-only.',
      status: 403,
    })
  })

  it('allows signup through the in-memory route outside production', async () => {
    delete process.env.SINOPEBASE_PRODUCTION
    delete process.env.ALLOW_SIGNUPS
    const email = `allowed-memory-${crypto.randomUUID()}@example.com`
    const response = await authPlugin.handle(
      new Request('http://localhost/auth/v1/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'password-123' }),
      }),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { access_token: string; user: { email: string } }
    expect(body.access_token).toBeTruthy()
    expect(body.user.email).toBe(email)
  })

  it('still validates required signup fields when signup is open', async () => {
    delete process.env.SINOPEBASE_PRODUCTION
    const response = await authPlugin.handle(
      new Request('http://localhost/auth/v1/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'password-123' }),
      }),
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      message: 'Email and password are required',
      status: 400,
    })
  })

  it('rejects signup through the PostgreSQL route before calling better-auth', async () => {
    process.env.SINOPEBASE_PRODUCTION = 'true'
    delete process.env.ALLOW_SIGNUPS
    const unexpectedCall = async (): Promise<never> => {
      throw new Error('better-auth must not be called when signup is closed')
    }
    const fakeAuth: Parameters<typeof createAuthPlugin>[0] = {
      api: {
        signUpEmail: unexpectedCall,
        signInEmail: unexpectedCall,
        signOut: unexpectedCall,
        getSession: unexpectedCall,
      },
    }
    const plugin = createAuthPlugin(fakeAuth)
    const response = await plugin.handle(
      new Request('http://localhost/auth/v1/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'blocked-postgres@example.com', password: 'password-123' }),
      }),
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      message: 'Signups are currently invite-only.',
      status: 403,
    })
  })

  it('allows an explicitly enabled production signup through better-auth', async () => {
    process.env.SINOPEBASE_PRODUCTION = 'true'
    process.env.ALLOW_SIGNUPS = 'true'
    const sessionHeaders = new Headers()
    sessionHeaders.append('set-cookie', 'session=one; Path=/; HttpOnly')
    sessionHeaders.append('set-cookie', 'csrf=two; Path=/; SameSite=Lax')
    const fakeAuth: Parameters<typeof createAuthPlugin>[0] = {
      api: {
        signUpEmail: async () => {},
        signInEmail: async () => ({
          headers: sessionHeaders,
          response: {
            token: 'signup-session-token',
            user: {
              id: 'signup-user-id',
              email: 'allowed-postgres@example.com',
            },
          },
        }),
        signOut: async () => {},
        getSession: async () => null,
      },
    }
    const response = await createAuthPlugin(fakeAuth).handle(
      new Request('http://localhost/auth/v1/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'allowed-postgres@example.com', password: 'password-123' }),
      }),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { access_token: string; user: { email: string } }
    expect(body.access_token).toBe('signup-session-token')
    expect(body.user.email).toBe('allowed-postgres@example.com')
    expect(response.headers.getSetCookie()).toHaveLength(2)
  })

  it('still validates required fields in the better-auth route when signup is open', async () => {
    process.env.SINOPEBASE_PRODUCTION = 'true'
    process.env.ALLOW_SIGNUPS = 'true'
    const unexpectedCall = async (): Promise<never> => {
      throw new Error('better-auth must not be called for an invalid request')
    }
    const fakeAuth: Parameters<typeof createAuthPlugin>[0] = {
      api: {
        signUpEmail: unexpectedCall,
        signInEmail: unexpectedCall,
        signOut: unexpectedCall,
        getSession: unexpectedCall,
      },
    }
    const response = await createAuthPlugin(fakeAuth).handle(
      new Request('http://localhost/auth/v1/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'password-123' }),
      }),
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      message: 'Email and password are required',
      status: 400,
    })
  })

  it('returns better-auth signup failures as client errors', async () => {
    process.env.SINOPEBASE_PRODUCTION = 'true'
    process.env.ALLOW_SIGNUPS = 'true'
    const fakeAuth: Parameters<typeof createAuthPlugin>[0] = {
      api: {
        signUpEmail: async () => {
          throw new Error('email domain is not allowed')
        },
        signInEmail: async () => {
          throw new Error('sign in should not follow a failed signup')
        },
        signOut: async () => {},
        getSession: async () => null,
      },
    }
    const response = await createAuthPlugin(fakeAuth).handle(
      new Request('http://localhost/auth/v1/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'blocked-domain@example.com', password: 'password-123' }),
      }),
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ message: 'email domain is not allowed', status: 400 })
  })
})
