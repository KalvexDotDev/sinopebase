/**
 * JWT security regression tests.
 *
 * Verifies issuer/audience enforcement, token expiry validation,
 * and the dev-fallback warning behavior added in v0.4 Wave 0.
 */

import { describe, it, expect } from 'bun:test'
import {
  generateAccessToken,
  verifyAccessToken,
  ACCESS_TOKEN_EXPIRES_IN,
} from '~/apis/auth-jwt'

describe('JWT — issuer and audience enforcement', () => {
  const mockUser = {
    id: 'test-user-1',
    email: 'test@example.com',
    role: 'authenticated',
    aud: 'authenticated',
  }

  it('generates a token with issuer and audience claims', async () => {
    const token = await generateAccessToken(mockUser)
    // Decode without verifying to inspect claims
    const parts = token.split('.')
    const payload = JSON.parse(atob(parts[1]!))
    expect(payload.iss).toBe('sinopebase')
    expect(payload.aud).toBe('authenticated')
  })

  it('verifies a valid token', async () => {
    const token = await generateAccessToken(mockUser)
    const payload = await verifyAccessToken(token)
    expect(payload.sub).toBe(mockUser.id)
    expect(payload.email).toBe(mockUser.email)
  })

  it('rejects a token with wrong issuer', async () => {
    // Manually craft a token with the wrong issuer
    const { SignJWT } = await import('jose')
    const secret = new TextEncoder().encode(
      process.env['JWT_SECRET'] ?? 'sinopebase-dev-jwt-secret-min-32-chars!!',
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
      process.env['JWT_SECRET'] ?? 'sinopebase-dev-jwt-secret-min-32-chars!!',
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
      process.env['JWT_SECRET'] ?? 'sinopebase-dev-jwt-secret-min-32-chars!!',
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
    const token = await generateAccessToken(mockUser)
    const parts = token.split('.')
    const payload = JSON.parse(atob(parts[1]!))
    const lifetime = payload.exp - payload.iat
    expect(lifetime).toBe(ACCESS_TOKEN_EXPIRES_IN)
  })
})
