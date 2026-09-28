// @new-code-test positive src/tools/auth-better/supabase-bridge.ts
// @new-code-test negative src/tools/auth-better/supabase-bridge.ts
// @new-code-test positive src/tools/auth-better/types.ts
// @new-code-test negative src/tools/auth-better/types.ts
import { describe, expect, it } from 'bun:test'
import { bridgeGetUserResponse, bridgeSignInResponse } from '~/tools/auth-better/supabase-bridge'

const betterAuthUser = {
  id: '42d9ec90-0294-4599-9a54-6dc4c9dd5387',
  email: 'user@example.com',
  emailVerified: true,
  name: null,
  image: null,
  role: 'authenticated',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
}

describe('better-auth Supabase bridge', () => {
  it('returns a GoTrue session at the response root', () => {
    const response = bridgeSignInResponse(
      { token: 'session-token', user: betterAuthUser },
      'opaque-refresh-token',
    )

    expect(response).toMatchObject({
      access_token: 'session-token',
      token_type: 'bearer',
      refresh_token: 'opaque-refresh-token',
      expires_in: 3600,
      user: {
        id: betterAuthUser.id,
        email: betterAuthUser.email,
        role: 'authenticated',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
      },
    })
    expect(response).not.toHaveProperty('data')
    expect(response).not.toHaveProperty('error')
  })

  it('defaults a missing role and timestamps', () => {
    const before = Date.now()
    const { user } = bridgeSignInResponse(
      {
        token: 't',
        user: {
          id: 'u',
          email: 'e@example.com',
          role: 'admin',
          createdAt: '2026-03-04T05:06:07.000Z',
        },
      },
      'r',
    )
    expect(user).toMatchObject({ role: 'admin', created_at: '2026-03-04T05:06:07.000Z' })
    expect(Date.parse(user.updated_at)).toBeGreaterThanOrEqual(before)

    const defaulted = bridgeSignInResponse(
      { token: 't', user: { id: 'u', email: 'e@example.com' } },
      'r',
    )
    expect(defaulted.user.role).toBe('authenticated')
    expect(Date.parse(defaulted.user.created_at)).toBeGreaterThanOrEqual(before)
  })

  it('returns a GoTrue user at the response root', () => {
    const response = bridgeGetUserResponse({ user: betterAuthUser, session: {} })

    expect(response).toMatchObject({
      id: betterAuthUser.id,
      email: betterAuthUser.email,
      aud: 'authenticated',
    })
    expect(response).not.toHaveProperty('data')
    expect(response).not.toHaveProperty('error')
  })

  it('returns a root-level error when there is no session', () => {
    expect(bridgeGetUserResponse(null)).toEqual({ message: 'Invalid token', status: 401 })
  })
})
