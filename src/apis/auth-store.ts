/**
 * In-memory user and refresh token store.
 * Temporary until the database layer is wired in.
 *
 * v2: Adds refresh token families with rotation tracking and replay detection.
 */

import type { User } from '../sdk/auth'

export interface StoredUser {
  id: string
  email: string
  passwordHash: string
  role: string
  aud: string
  app_metadata: Record<string, unknown>
  user_metadata: Record<string, unknown>
  created_at: string
  updated_at: string
  email_confirmed_at?: string
  phone?: string
  last_sign_in_at?: string
}

export interface StoredRefreshToken {
  tokenId: string
  userId: string
  sessionId: string
  familyId: string
  expiresAt: Date
  consumed: boolean
  /** jti of the previous token in the rotation chain (undefined for first token) */
  parentTokenId?: string
}

export interface RefreshTokenFamily {
  userId: string
  sessionId: string
  tokenIds: string[]
  compromised: boolean
}

class AuthStore {
  private usersByEmail = new Map<string, StoredUser>()
  private usersById = new Map<string, StoredUser>()
  /** Map<tokenId (jti), StoredRefreshToken> */
  private refreshTokens = new Map<string, StoredRefreshToken>()
  /** Map<familyId, RefreshTokenFamily> */
  private refreshTokenFamilies = new Map<string, RefreshTokenFamily>()

  async createUser(email: string, passwordHash: string): Promise<StoredUser> {
    if (this.usersByEmail.has(email)) {
      throw new Error('User already exists')
    }
    const now = new Date().toISOString()
    const user: StoredUser = {
      id: crypto.randomUUID(),
      email,
      passwordHash,
      role: 'authenticated',
      aud: 'authenticated',
      app_metadata: {},
      user_metadata: {},
      created_at: now,
      updated_at: now,
      email_confirmed_at: now,
      last_sign_in_at: now,
    }
    this.usersByEmail.set(email, user)
    this.usersById.set(user.id, user)
    return user
  }

  findUserByEmail(email: string): StoredUser | undefined {
    return this.usersByEmail.get(email)
  }

  findUserById(id: string): StoredUser | undefined {
    return this.usersById.get(id)
  }

  updateLastSignIn(userId: string): void {
    const user = this.usersById.get(userId)
    if (user) {
      user.last_sign_in_at = new Date().toISOString()
      user.updated_at = user.last_sign_in_at
    }
  }

  /**
   * Store a new refresh token with full family tracking metadata.
   *
   * @param tokenId     - The jti claim from the refresh JWT
   * @param userId      - Owning user
   * @param sessionId   - Session this token belongs to
   * @param familyId    - Refresh token family (shared across rotations)
   * @param parentTokenId - jti of the previous token in the rotation chain (undefined for first)
   */
  addRefreshToken(
    tokenId: string,
    userId: string,
    sessionId: string,
    familyId: string,
    parentTokenId?: string,
  ): void {
    // Ensure family exists
    let family = this.refreshTokenFamilies.get(familyId)
    if (!family) {
      family = { userId, sessionId, tokenIds: [], compromised: false }
      this.refreshTokenFamilies.set(familyId, family)
    }

    // Store the token
    this.refreshTokens.set(tokenId, {
      tokenId,
      userId,
      sessionId,
      familyId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      consumed: false,
      parentTokenId,
    })

    // Add to family chain
    family.tokenIds.push(tokenId)
  }

  /**
   * Validate a refresh token for rotation with replay detection.
   *
   * Returns:
   * - { valid: true, data } if the token can be safely rotated
   * - { valid: false, replay: true, compromised: true } if the token was ALREADY consumed (replay attack)
   * - { valid: false, compromised: true } if the family has been marked compromised
   * - { valid: false } if the token is missing or expired
   *
   * On replay detection the ENTIRE family is marked compromised, invalidating
   * all current and future tokens in that family chain.
   */
  validateTokenForRotation(
    tokenId: string,
  ): { valid: true; data: StoredRefreshToken } | { valid: false; replay: boolean; compromised: boolean } {
    const data = this.refreshTokens.get(tokenId)

    // Token not found or expired
    if (!data || data.expiresAt < new Date()) {
      return { valid: false, replay: false, compromised: false }
    }

    const family = this.refreshTokenFamilies.get(data.familyId)

    // Family already compromised — reject
    if (family?.compromised) {
      return { valid: false, replay: false, compromised: true }
    }

    // Token already consumed — this is a REPLAY ATTACK
    if (data.consumed) {
      // Mark entire family as compromised
      if (family) {
        family.compromised = true
        // Remove all tokens in this family from active storage
        for (const tid of family.tokenIds) {
          this.refreshTokens.delete(tid)
        }
      }
      return { valid: false, replay: true, compromised: true }
    }

    return { valid: true, data }
  }

  /**
   * Mark a refresh token as consumed after successful rotation.
   * The token remains in the map for replay detection but is no longer usable.
   */
  consumeRefreshToken(tokenId: string): void {
    const data = this.refreshTokens.get(tokenId)
    if (data) {
      data.consumed = true
    }
  }

  /**
   * Invalidate a session: removes all its refresh tokens and marks
   * the session's families as compromised.
   */
  invalidateSession(sid: string): void {
    const tokensToRemove: string[] = []
    for (const [tokenId, data] of this.refreshTokens) {
      if (data.sessionId === sid) {
        tokensToRemove.push(tokenId)
      }
    }
    for (const tid of tokensToRemove) {
      this.refreshTokens.delete(tid)
    }
    for (const family of this.refreshTokenFamilies.values()) {
      if (family.sessionId === sid) {
        family.compromised = true
      }
    }
  }

  /**
   * Invalidate a user: removes all their refresh tokens and marks
   * all their families as compromised.
   */
  invalidateUser(userId: string): void {
    const tokensToRemove: string[] = []
    for (const [tokenId, data] of this.refreshTokens) {
      if (data.userId === userId) {
        tokensToRemove.push(tokenId)
      }
    }
    for (const tid of tokensToRemove) {
      this.refreshTokens.delete(tid)
    }
    for (const family of this.refreshTokenFamilies.values()) {
      if (family.userId === userId) {
        family.compromised = true
      }
    }
  }

  /**
   * Invalidate an entire refresh token family.
   */
  invalidateFamily(familyId: string): void {
    const family = this.refreshTokenFamilies.get(familyId)
    if (family) {
      family.compromised = true
      for (const tid of family.tokenIds) {
        this.refreshTokens.delete(tid)
      }
    }
  }

  removeAllRefreshTokensForUser(userId: string): void {
    // Also marks families as compromised for consistency
    const tokensToRemove: string[] = []
    for (const [tokenId, data] of this.refreshTokens) {
      if (data.userId === userId) {
        tokensToRemove.push(tokenId)
      }
    }
    for (const tid of tokensToRemove) {
      this.refreshTokens.delete(tid)
    }
    for (const family of this.refreshTokenFamilies.values()) {
      if (family.userId === userId) {
        family.compromised = true
      }
    }
  }

  toUser(stored: StoredUser): User {
    return {
      id: stored.id,
      email: stored.email,
      role: stored.role,
      aud: stored.aud,
      app_metadata: stored.app_metadata,
      user_metadata: stored.user_metadata,
      created_at: stored.created_at,
      updated_at: stored.updated_at,
      email_confirmed_at: stored.email_confirmed_at,
      phone: stored.phone,
      last_sign_in_at: stored.last_sign_in_at,
    }
  }
}

export const authStore = new AuthStore()
