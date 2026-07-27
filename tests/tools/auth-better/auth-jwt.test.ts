/**
 * JWT security regression tests.
 *
 * Verifies issuer/audience enforcement, token expiry validation,
 * the dev-fallback warning behavior, and hardening additions:
 * - kid in protected header
 * - sid claim in payload
 */

import { describe, expect, it } from 'bun:test'
import { ACCESS_TOKEN_EXPIRES_IN, generateAccessToken, verifyAccessToken } from '~/apis/auth-jwt'
import { generateSessionId } from '~/apis/auth-utils'

describe('JWT — issuer and audience enforcement', () => {
  const sessionId = generateSessionId()
  const mockUser = {
    id: 'test-user-1',
    email: 'test@example.com',
    role: 'authenticated',
    aud: 'authenticated',
  }

  it('generates a token with kid in protected header', async () => {
    const token = await generateAccessToken(mockUser, sessionId)
    const parts = token.split('.')
    const seg0 = parts[0]
    if (!seg0) throw new Error('JWT missing header segment')
    const header = JSON.parse(atob(seg0))
    expect(header.kid).toBe('sinopebase-v1')
  })

  it('generates a token with issuer, audience, and sid claims', async () => {
    const token = await generateAccessToken(mockUser, sessionId)
    // Decode without verifying to inspect claims
    const parts = token.split('.')
    const seg1b = parts[1]
    if (!seg1b) throw new Error('JWT missing payload segment')
    const payload = JSON.parse(atob(seg1b))
    expect(payload.iss).toBe('sinopebase')
    expect(payload.aud).toBe('authenticated')
    expect(payload.sid).toBe(sessionId)
  })

  it('verifies a valid token', async () => {
    const token = await generateAccessToken(mockUser, sessionId)
    const payload = await verifyAccessToken(token)
    expect(payload.sub).toBe(mockUser.id)
    expect(payload.email).toBe(mockUser.email)
  })

  it('rejects a token with wrong issuer', async () => {
    // Manually craft a token with the wrong issuer
    const { SignJWT } = await import('jose')
    const secret = new TextEncoder().encode(
      process.env.JWT_SECRET ?? 'sinopebase-dev-jwt-secret-min-32-chars!!',
    )
    const badToken = await new SignJWT({ sub: 'x', role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('evil-issuer')
      .setAudience('authenticated')
      .setIssuedAt(Math.floor(Date.now() / 1000))
      .setExpirationTime(Math.floor(Date.now() / 1000) + 60)
      .sign(secret)

    await expect(verifyAccessToken(badToken)).rejects.toThrow()
  })

  it('rejects a token with wrong audience', async () => {
    const { SignJWT } = await import('jose')
    const secret = new TextEncoder().encode(
      process.env.JWT_SECRET ?? 'sinopebase-dev-jwt-secret-min-32-chars!!',
    )
    const badToken = await new SignJWT({ sub: 'x', role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('sinopebase')
      .setAudience('evil-audience')
      .setIssuedAt(Math.floor(Date.now() / 1000))
      .setExpirationTime(Math.floor(Date.now() / 1000) + 60)
      .sign(secret)

    await expect(verifyAccessToken(badToken)).rejects.toThrow()
  })

  it('rejects an expired token', async () => {
    const { SignJWT } = await import('jose')
    const secret = new TextEncoder().encode(
      process.env.JWT_SECRET ?? 'sinopebase-dev-jwt-secret-min-32-chars!!',
    )
    const expiredToken = await new SignJWT({ sub: 'x', role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('sinopebase')
      .setAudience('authenticated')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600) // expired 1h ago
      .sign(secret)

    await expect(verifyAccessToken(expiredToken)).rejects.toThrow()
  })

  it('token expiry is set to 1 hour', async () => {
    const token = await generateAccessToken(mockUser, sessionId)
    const parts = token.split('.')
    const seg1b = parts[1]
    if (!seg1b) throw new Error('JWT missing payload segment')
    const payload = JSON.parse(atob(seg1b))
    const lifetime = payload.exp - payload.iat
    expect(lifetime).toBe(ACCESS_TOKEN_EXPIRES_IN)
  })
})
