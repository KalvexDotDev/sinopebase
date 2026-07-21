/**
 * In-memory user and refresh token store.
 * Temporary until the database layer is wired in.
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
  token: string
  userId: string
  expiresAt: Date
}

class AuthStore {
  private usersByEmail = new Map<string, StoredUser>()
  private usersById = new Map<string, StoredUser>()
  private refreshTokens = new Map<string, StoredRefreshToken>()

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

  addRefreshToken(token: string, userId: string): void {
    this.refreshTokens.set(token, {
      token,
      userId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    })
  }

  consumeRefreshToken(token: string): StoredRefreshToken | undefined {
    const data = this.refreshTokens.get(token)
    if (!data) return undefined
    if (data.expiresAt < new Date()) {
      this.refreshTokens.delete(token)
      return undefined
    }
    this.refreshTokens.delete(token)
    return data
  }

  removeRefreshToken(token: string): void {
    this.refreshTokens.delete(token)
  }

  removeAllRefreshTokensForUser(userId: string): void {
    for (const [token, data] of this.refreshTokens) {
      if (data.userId === userId) {
        this.refreshTokens.delete(token)
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
