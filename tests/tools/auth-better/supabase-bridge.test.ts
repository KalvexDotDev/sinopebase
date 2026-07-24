import { describe, expect, it } from 'bun:test'
import {
  bridgeGetUserResponse,
  bridgeSignInResponse,
} from '~/tools/auth-better/supabase-bridge'

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
    const response = bridgeSignInResponse({
      token: 'session-token',
      user: betterAuthUser,
    })

    expect(response).toMatchObject({
      access_token: 'session-token',
      token_type: 'bearer',
      refresh_token: 'session-token',
      user: {
        id: betterAuthUser.id,
        email: betterAuthUser.email,
      },
    })
    expect(response).not.toHaveProperty('data')
    expect(response).not.toHaveProperty('error')
  })

  it('returns a GoTrue user at the response root', () => {
    const response = bridgeGetUserResponse({ user: betterAuthUser })

    expect(response).toMatchObject({
      id: betterAuthUser.id,
      email: betterAuthUser.email,
      aud: 'authenticated',
    })
    expect(response).not.toHaveProperty('data')
    expect(response).not.toHaveProperty('error')
  })

  it('returns a root-level error message when authentication fails', () => {
    expect(bridgeSignInResponse(null)).toEqual({
      message: 'Authentication failed',
      status: 400,
    })
  })
})
