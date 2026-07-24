/**
 * Auth hardening tests — Sinopebase Wave 1.
 *
 * Tests for:
 * - kid in JWT header
 * - All required claims present (iss, aud, sub, email, role, sid, jti, iat, exp)
 * - Access token 1h expiry
 * - Refresh token 7d expiry
 * - Refresh rotation: old token consumed, new token works
 * - Replay detection: second use of same refresh token invalidates family
 * - Session invalidation
 * - Malformed/expired/wrong-issuer/audience tokens rejected
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import {
  generateAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL,
} from '~/apis/auth-jwt'
import { generateSessionId, generateTokenId, generateFamilyId, getTokenKid, isTokenExpired, getTokenSessionId } from '~/apis/auth-utils'
import { authStore } from '~/apis/auth-store'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockUser = {
  id: 'hardening-test-user',
  email: 'hardening@test.example.com',
  role: 'authenticated',
  aud: 'authenticated',
  app_metadata: {} as Record<string, unknown>,
  user_metadata: {} as Record<string, unknown>,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

async function createTokens() {
  const sessionId = generateSessionId()
  const tokenId = generateTokenId()
  const familyId = generateFamilyId()
  const accessToken = await generateAccessToken(mockUser, sessionId)
  const refreshToken = await generateRefreshToken(mockUser.id, sessionId, tokenId, familyId)
  return { sessionId, tokenId, familyId, accessToken, refreshToken }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('JWT — protected header', () => {
  it('includes kid in access token header', async () => {
    const { accessToken } = await createTokens()
    const kid = getTokenKid(accessToken)
    expect(kid).toBe('sinopebase-v1')
  })

  it('includes kid in refresh token header', async () => {
    const { refreshToken } = await createTokens()
    const kid = getTokenKid(refreshToken)
    expect(kid).toBe('sinopebase-v1')
  })
})

describe('JWT — access token claims', () => {
  it('contains all required claims', async () => {
    const { accessToken, sessionId } = await createTokens()
    const parts = accessToken.split('.')
    const payload = JSON.parse(atob(parts[1]!))

    expect(payload).toHaveProperty('iss', 'sinopebase')
    expect(payload).toHaveProperty('aud', 'authenticated')
    expect(payload).toHaveProperty('sub', mockUser.id)
    expect(payload).toHaveProperty('email', mockUser.email)
    expect(payload).toHaveProperty('role', mockUser.role)
    expect(payload).toHaveProperty('sid', sessionId)
    expect(payload).toHaveProperty('jti')
    expect(typeof payload.jti).toBe('string')
    expect(payload).toHaveProperty('iat')
    expect(typeof payload.iat).toBe('number')
    expect(payload).toHaveProperty('exp')
    expect(typeof payload.exp).toBe('number')
  })

  it('expires after ACCESS_TOKEN_TTL (1 hour)', async () => {
    const { accessToken } = await createTokens()
    const parts = accessToken.split('.')
    const payload = JSON.parse(atob(parts[1]!))
    const lifetime = payload.exp - payload.iat
    expect(lifetime).toBe(ACCESS_TOKEN_TTL)
  })

  it('is verifiable', async () => {
    const { accessToken } = await createTokens()
    const payload = await verifyAccessToken(accessToken)
    expect(payload.sub).toBe(mockUser.id)
    expect(payload.email).toBe(mockUser.email)
  })
})

describe('JWT — refresh token claims', () => {
  it('contains all required claims', async () => {
    const sessionId = generateSessionId()
    const tokenId = generateTokenId()
    const familyId = generateFamilyId()
    const refreshToken = await generateRefreshToken(mockUser.id, sessionId, tokenId, familyId)

    const parts = refreshToken.split('.')
    const payload = JSON.parse(atob(parts[1]!))

    expect(payload).toHaveProperty('sub', mockUser.id)
    expect(payload).toHaveProperty('sid', sessionId)
    expect(payload).toHaveProperty('jti', tokenId)
    expect(payload).toHaveProperty('family', familyId)
    expect(payload).toHaveProperty('iss', 'sinopebase')
    expect(payload).toHaveProperty('aud', 'authenticated')
    expect(payload).toHaveProperty('iat')
    expect(typeof payload.iat).toBe('number')
    expect(payload).toHaveProperty('exp')
    expect(typeof payload.exp).toBe('number')
  })

  it('expires after REFRESH_TOKEN_TTL (7 days)', async () => {
    const sessionId = generateSessionId()
    const tokenId = generateTokenId()
    const familyId = generateFamilyId()
    const refreshToken = await generateRefreshToken(mockUser.id, sessionId, tokenId, familyId)

    const parts = refreshToken.split('.')
    const payload = JSON.parse(atob(parts[1]!))
    const lifetime = payload.exp - payload.iat
    expect(lifetime).toBe(REFRESH_TOKEN_TTL)
  })

  it('is verifiable', async () => {
    const sessionId = generateSessionId()
    const tokenId = generateTokenId()
    const familyId = generateFamilyId()
    const refreshToken = await generateRefreshToken(mockUser.id, sessionId, tokenId, familyId)

    const payload = await verifyRefreshToken(refreshToken)
    expect(payload.sub).toBe(mockUser.id)
    expect(payload.sid).toBe(sessionId)
    expect(payload.jti).toBe(tokenId)
    expect(payload.family).toBe(familyId)
  })
})

describe('Auth store — token families', () => {
  const testUserId = `test-user-${crypto.randomUUID()}`

  it('addRefreshToken stores token with family tracking', () => {
    const familyId = generateFamilyId()
    const sessionId = generateSessionId()
    const tokenId = generateTokenId()

    authStore.addRefreshToken(tokenId, testUserId, sessionId, familyId)

    // First use should be valid
    const result = authStore.validateTokenForRotation(tokenId)
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.data.sessionId).toBe(sessionId)
      expect(result.data.familyId).toBe(familyId)
    }
  })

  it('consumeRefreshToken marks token consumed — replay detected on reuse', () => {
    const familyId = generateFamilyId()
    const sessionId = generateSessionId()
    const tokenId = generateTokenId()

    authStore.addRefreshToken(tokenId, testUserId, sessionId, familyId)

    // Consume it (normal rotation step)
    authStore.consumeRefreshToken(tokenId)

    // Second validation — should be detected as replay
    const result = authStore.validateTokenForRotation(tokenId)
    if (result.valid) throw new Error('Expected invalid')
    expect(result.replay).toBe(true)
    expect(result.compromised).toBe(true)
  })
})

describe('Refresh token rotation', () => {
  const testUserId = `rotation-user-${crypto.randomUUID()}`

  it('new tokens work after rotation', () => {
    const sessionId = generateSessionId()
    const tokenId1 = generateTokenId()
    const familyId = generateFamilyId()

    // Store initial token
    authStore.addRefreshToken(tokenId1, testUserId, sessionId, familyId)

    // Validate and consume
    const validation1 = authStore.validateTokenForRotation(tokenId1)
    expect(validation1.valid).toBe(true)
    authStore.consumeRefreshToken(tokenId1)

    // Issue new token in same family
    const tokenId2 = generateTokenId()
    authStore.addRefreshToken(tokenId2, testUserId, sessionId, familyId, tokenId1)

    // New token should be valid
    const validation2 = authStore.validateTokenForRotation(tokenId2)
    expect(validation2.valid).toBe(true)
  })

  it('old token is rejected after rotation', () => {
    const sessionId = generateSessionId()
    const tokenId1 = generateTokenId()
    const familyId = generateFamilyId()

    authStore.addRefreshToken(tokenId1, testUserId, sessionId, familyId)

    // Consume and rotate
    authStore.consumeRefreshToken(tokenId1)
    const tokenId2 = generateTokenId()
    authStore.addRefreshToken(tokenId2, testUserId, sessionId, familyId, tokenId1)

    // Old token should be rejected as replay
    const result = authStore.validateTokenForRotation(tokenId1)
    if (result.valid) throw new Error('Expected invalid')
    expect(result.replay).toBe(true)
  })
})

describe('Replay detection', () => {
  const testUserId = `replay-user-${crypto.randomUUID()}`

  it('detects second use of same refresh token and compromises family', () => {
    const sessionId = generateSessionId()
    const tokenId = generateTokenId()
    const familyId = generateFamilyId()

    authStore.addRefreshToken(tokenId, testUserId, sessionId, familyId)

    // First consume (simulates normal rotation)
    authStore.consumeRefreshToken(tokenId)

    // Second validation of the same token — should be detected as replay
    const replayResult = authStore.validateTokenForRotation(tokenId)
    if (replayResult.valid) throw new Error('Expected invalid')
    expect(replayResult.replay).toBe(true)
    expect(replayResult.compromised).toBe(true)

    // Any further token in this family should also be rejected
    const otherTokenId = generateTokenId()
    authStore.addRefreshToken(otherTokenId, testUserId, sessionId, familyId, tokenId)
    const otherResult = authStore.validateTokenForRotation(otherTokenId)
    if (otherResult.valid) throw new Error('Expected invalid')
    expect(otherResult.compromised).toBe(true)
  })
})

describe('Session invalidation', () => {
  const testUserId = `session-inv-user-${crypto.randomUUID()}`
  const targetSessionId = `target-session-${crypto.randomUUID()}`
  const otherSessionId = `other-session-${crypto.randomUUID()}`

  let targetTokenId: string
  let otherTokenId: string

  beforeEach(() => {
    targetTokenId = generateTokenId()
    otherTokenId = generateTokenId()

    // Each session gets its own family (as in real usage)
    authStore.addRefreshToken(targetTokenId, testUserId, targetSessionId, generateFamilyId())
    authStore.addRefreshToken(otherTokenId, testUserId, otherSessionId, generateFamilyId())
  })

  it('invalidateSession removes only tokens for that session', () => {
    authStore.invalidateSession(targetSessionId)

    // Target session token should be gone
    const targetResult = authStore.validateTokenForRotation(targetTokenId)
    expect(targetResult.valid).toBe(false)

    // Other session token should still be valid
    const otherResult = authStore.validateTokenForRotation(otherTokenId)
    expect(otherResult.valid).toBe(true)
  })
})

describe('User invalidation', () => {
  const testUserId = `user-inv-test-${crypto.randomUUID()}`
  const sessionId = generateSessionId()
  const tokenId = generateTokenId()
  const familyId = generateFamilyId()

  beforeEach(() => {
    // Clean up by invalidating user first
    authStore.invalidateUser(testUserId)
  })

  it('invalidateUser removes all tokens for that user', () => {
    authStore.addRefreshToken(tokenId, testUserId, sessionId, familyId)

    authStore.invalidateUser(testUserId)
    const result = authStore.validateTokenForRotation(tokenId)
    expect(result.valid).toBe(false)
  })
})

describe('Token verification — rejection cases', () => {
  it('rejects malformed token', async () => {
    await expect(verifyAccessToken('not-a-jwt')).rejects.toThrow()
  })

  it('rejects token with wrong issuer', async () => {
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

  it('rejects token with wrong audience', async () => {
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

  it('rejects expired token', async () => {
    const { SignJWT } = await import('jose')
    const secret = new TextEncoder().encode(
      process.env['JWT_SECRET'] ?? 'sinopebase-dev-jwt-secret-min-32-chars!!',
    )
    const expiredToken = await new SignJWT({ sub: 'x', role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('sinopebase')
      .setAudience('authenticated')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(secret)

    await expect(verifyAccessToken(expiredToken)).rejects.toThrow()
  })
})

describe('Auth utilities', () => {
  it('getTokenKid returns kid from header', async () => {
    const { accessToken } = await createTokens()
    expect(getTokenKid(accessToken)).toBe('sinopebase-v1')
  })

  it('getTokenKid returns undefined for malformed token', () => {
    expect(getTokenKid('not-a-jwt')).toBeUndefined()
  })

  it('getTokenSessionId returns sid from payload', async () => {
    const { accessToken, sessionId } = await createTokens()
    expect(getTokenSessionId(accessToken)).toBe(sessionId)
  })

  it('isTokenExpired returns false for valid token', async () => {
    const { accessToken } = await createTokens()
    expect(isTokenExpired(accessToken)).toBe(false)
  })

  it('isTokenExpired returns true for expired token', async () => {
    const { SignJWT } = await import('jose')
    const secret = new TextEncoder().encode(
      process.env['JWT_SECRET'] ?? 'sinopebase-dev-jwt-secret-min-32-chars!!',
    )
    const expiredToken = await new SignJWT({ sub: 'x' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(secret)

    expect(isTokenExpired(expiredToken)).toBe(true)
  })

  it('isTokenExpired respects leeway', async () => {
    // Just-expired token — should pass with leeway
    const { SignJWT } = await import('jose')
    const secret = new TextEncoder().encode(
      process.env['JWT_SECRET'] ?? 'sinopebase-dev-jwt-secret-min-32-chars!!',
    )
    const justExpiredToken = await new SignJWT({ sub: 'x' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 5) // 5 seconds ago
      .sign(secret)

    // Without leeway: expired
    expect(isTokenExpired(justExpiredToken)).toBe(true)
    // With 10s leeway: still valid
    expect(isTokenExpired(justExpiredToken, 10)).toBe(false)
  })

  it('isTokenExpired returns true for token with no exp', () => {
    expect(isTokenExpired({})).toBe(true)
  })

  it('isTokenExpired accepts decoded object', () => {
    const now = Math.floor(Date.now() / 1000)
    expect(isTokenExpired({ exp: now + 3600 })).toBe(false)
    expect(isTokenExpired({ exp: now - 10 })).toBe(true)
  })

  it('generateSessionId returns valid UUID', () => {
    const id = generateSessionId()
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })

  it('generateTokenId returns valid UUID', () => {
    const id = generateTokenId()
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })

  it('generateFamilyId returns valid UUID', () => {
    const id = generateFamilyId()
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })
})
