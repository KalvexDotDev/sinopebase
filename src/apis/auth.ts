/**
 * Auth API routes — Supabase-compatible /auth/v1/* endpoints.
 *
 * Implements the same response shapes as supabase-js GoTrue client expects.
 * Uses jose for JWT generation/verification and an in-memory store for users.
 *
 * v2: Refresh token rotation with family-based replay detection.
 */

import { Elysia } from 'elysia'
import { lookupSessionByToken } from '~/tools/auth-better'
import {
  type BetterAuthGetSessionResult,
  type BetterAuthSignInResult,
  bridgeGetUserResponse,
  bridgeSignInResponse,
} from '~/tools/auth-better/supabase-bridge'
import {
  ACCESS_TOKEN_TTL,
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from './auth-jwt'
import { authStore } from './auth-store'
import { generateFamilyId, generateSessionId, generateTokenId } from './auth-utils'

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function sessionResponse(
  user: ReturnType<typeof authStore.toUser>,
  accessToken: string,
  refreshToken: string,
) {
  const now = Math.floor(Date.now() / 1000)
  return {
    access_token: accessToken,
    token_type: 'bearer' as const,
    expires_in: ACCESS_TOKEN_TTL,
    expires_at: now + ACCESS_TOKEN_TTL,
    refresh_token: refreshToken,
    user,
  }
}

function errorResponse(message: string, status: number) {
  return { message, status }
}

function userResponse(user: ReturnType<typeof authStore.toUser>) {
  return user
}

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------

export const authPlugin = new Elysia()
  .post('/auth/v1/signup', async ({ body, set }) => {
    const { email, password } = body as {
      email: string
      password: string
    }

    if (!email || !password) {
      set.status = 400
      return errorResponse('Email and password are required', 400)
    }

    const existing = authStore.findUserByEmail(email)
    if (existing) {
      set.status = 400
      return errorResponse('User already exists', 400)
    }

    const passwordHash = await Bun.password.hash(password)
    const storedUser = await authStore.createUser(email, passwordHash)
    const user = authStore.toUser(storedUser)

    // Issue tokens with session and family tracking
    const sessionId = generateSessionId()
    const tokenId = generateTokenId()
    const familyId = generateFamilyId()

    const accessToken = await generateAccessToken(user, sessionId)
    const refreshToken = await generateRefreshToken(user.id, sessionId, tokenId, familyId)

    authStore.addRefreshToken(tokenId, user.id, sessionId, familyId)

    return sessionResponse(user, accessToken, refreshToken)
  })

  .post('/auth/v1/token', async ({ body, query, set }) => {
    const grantType = query.grant_type as string | undefined

    if (grantType === 'password') {
      // Sign in with email + password
      const { email, password } = body as {
        email: string
        password: string
      }

      if (!email || !password) {
        set.status = 400
        return errorResponse('Invalid login credentials', 400)
      }

      const storedUser = authStore.findUserByEmail(email)
      if (!storedUser) {
        set.status = 400
        return errorResponse('Invalid login credentials', 400)
      }

      const valid = await Bun.password.verify(password, storedUser.passwordHash)
      if (!valid) {
        set.status = 400
        return errorResponse('Invalid login credentials', 400)
      }

      authStore.updateLastSignIn(storedUser.id)
      const user = authStore.toUser(storedUser)

      // Issue tokens with session and family tracking
      const sessionId = generateSessionId()
      const tokenId = generateTokenId()
      const familyId = generateFamilyId()

      const accessToken = await generateAccessToken(user, sessionId)
      const refreshToken = await generateRefreshToken(user.id, sessionId, tokenId, familyId)

      authStore.addRefreshToken(tokenId, user.id, sessionId, familyId)

      return sessionResponse(user, accessToken, refreshToken)
    }

    if (grantType === 'refresh_token') {
      // Refresh session — with rotation + replay detection
      const { refresh_token } = body as { refresh_token?: string }

      if (!refresh_token) {
        set.status = 400
        return errorResponse('Invalid refresh token', 400)
      }

      // 1. Verify the refresh JWT
      let claims: Awaited<ReturnType<typeof verifyRefreshToken>>
      try {
        claims = await verifyRefreshToken(refresh_token)
      } catch {
        set.status = 400
        return errorResponse('Invalid refresh token', 400)
      }

      // 2. Validate token for rotation (checks expiry, family status, and replay)
      const validation = authStore.validateTokenForRotation(claims.jti)

      if (validation.valid === false && validation.replay) {
        // REPLAY ATTACK DETECTED — family is now compromised
        set.status = 400
        return errorResponse('Invalid refresh token', 400)
      }

      if (validation.valid === false && validation.compromised) {
        // Family was previously compromised
        set.status = 400
        return errorResponse('Invalid refresh token', 400)
      }

      if (validation.valid === false) {
        set.status = 400
        return errorResponse('Invalid refresh token', 400)
      }

      // 3. Consume the old token (marks it as used)
      authStore.consumeRefreshToken(claims.jti)

      // 4. Look up user
      const storedUser = authStore.findUserById(claims.sub)
      if (!storedUser) {
        set.status = 400
        return errorResponse('Invalid refresh token', 400)
      }

      const user = authStore.toUser(storedUser)

      // 5. Issue new pair with SAME family, new session ID and token ID
      const newSessionId = generateSessionId()
      const newTokenId = generateTokenId()

      const accessToken = await generateAccessToken(user, newSessionId)
      const newRefreshToken = await generateRefreshToken(
        user.id,
        newSessionId,
        newTokenId,
        claims.family,
      )

      authStore.addRefreshToken(newTokenId, user.id, newSessionId, claims.family, claims.jti)

      return sessionResponse(user, accessToken, newRefreshToken)
    }

    // Unknown grant type
    set.status = 400
    return errorResponse('Invalid grant type', 400)
  })

  .post('/auth/v1/logout', async ({ headers }) => {
    // Invalidate the user's refresh tokens if a Bearer token is provided
    const authHeader = headers.authorization
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim()
      if (token) {
        try {
          const payload = await verifyAccessToken(token)
          // Invalidate by session for precision
          if (payload.sid) {
            authStore.invalidateSession(payload.sid)
          } else {
            authStore.removeAllRefreshTokensForUser(payload.sub)
          }
        } catch {
          // Token invalid — still acknowledge logout
        }
      }
    }
    return {}
  })

  .get('/auth/v1/user', async ({ headers, set }) => {
    const authHeader = headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      set.status = 401
      return { message: 'Invalid authorization header' }
    }

    const token = authHeader.slice(7).trim()
    if (!token) {
      set.status = 401
      return { message: 'Invalid authorization header' }
    }

    let payload: { sub: string; email: string }
    try {
      payload = await verifyAccessToken(token)
    } catch {
      set.status = 401
      return { message: 'Invalid authorization header' }
    }

    const storedUser = authStore.findUserById(payload.sub)
    if (!storedUser) {
      set.status = 401
      return { message: 'Invalid authorization header' }
    }

    const user = authStore.toUser(storedUser)
    return userResponse(user)
  })

export { errorResponse, sessionResponse, userResponse }

/**
 * Minimal interface for the better-auth instance used by the auth plugin.
 * Only the surface that this module actually calls is typed.
 */
interface BetterAuthInstance {
  api: {
    signUpEmail(args: { body: { email: string; password: string; name: string } }): Promise<void>
    signInEmail(args: {
      body: { email: string; password: string }
    }): Promise<BetterAuthSignInResult>
    signOut(args: { headers: Headers }): Promise<void>
    getSession(args: { headers: Headers }): Promise<BetterAuthGetSessionResult | null>
  }
  /** Kysely-like database handle. Kept wide to avoid coupling to Kysely generics. */
  __db?: {
    selectFrom(table: string): {
      select(columns: string): {
        where(
          col: string,
          op: string,
          val: unknown,
        ): { execute(): Promise<Array<Record<string, unknown>>> }
      }
    }
    updateTable?(table: string): {
      set(data: Record<string, unknown>): {
        where(col: string, op: string, val: unknown): { execute(): Promise<unknown> }
      }
    }
  }
  [key: string]: unknown
}

export function createAuthPlugin(auth: BetterAuthInstance) {
  return new Elysia()
    .post('/auth/v1/signup', async ({ body, set }) => {
      const { email, password } = body as { email: string; password: string }
      if (!email || !password) {
        set.status = 400
        return errorResponse('Email and password are required', 400)
      }
      try {
        // Sign up via better-auth, then sign in to get a session token
        await auth.api.signUpEmail({ body: { email, password, name: '' } })
        const signInResult = await auth.api.signInEmail({ body: { email, password } })
        return bridgeSignInResponse(signInResult)
      } catch (err: unknown) {
        set.status = 400
        return errorResponse(err instanceof Error ? err.message : 'Signup failed', 400)
      }
    })
    .post('/auth/v1/token', async ({ body, query, set }) => {
      const q = query as Record<string, string>
      const grantType = q.grant_type
      if (grantType === 'password') {
        const { email, password } = body as { email: string; password: string }
        if (!email || !password) {
          set.status = 400
          return errorResponse('Invalid login credentials', 400)
        }
        try {
          const result = await auth.api.signInEmail({ body: { email, password } })
          return bridgeSignInResponse(result)
        } catch (err: unknown) {
          set.status = 400
          return errorResponse(
            err instanceof Error ? err.message : 'Invalid login credentials',
            400,
          )
        }
      }
      if (grantType === 'refresh_token') {
        const { refresh_token } = body as { refresh_token?: string }
        if (!refresh_token) {
          set.status = 400
          return errorResponse('Invalid refresh token', 400)
        }
        try {
          const row = await lookupSessionByToken(auth, refresh_token)
          if (!row) {
            set.status = 400
            return errorResponse('Invalid refresh token', 400)
          }
          // Rotate the session token — invalidate old token, issue new one
          const db = auth.__db
          if (!db) throw new Error('Database not available for token rotation')
          const newToken = crypto.randomUUID().replace(/-/g, '')
          const rows = await db
            .selectFrom('session')
            .select('session.id')
            .where('session.token', '=', refresh_token)
            .execute()
          const sessionId = (rows[0] as Record<string, unknown> | undefined)?.id as
            | string
            | undefined
          if (sessionId && db.updateTable) {
            await db
              .updateTable('session')
              .set({ token: newToken, updatedAt: new Date() })
              .where('session.id', '=', sessionId)
              .execute()
          }
          return bridgeSignInResponse({ token: newToken, user: row })
        } catch {
          set.status = 400
          return errorResponse('Invalid refresh token', 400)
        }
      }
      set.status = 400
      return errorResponse('Invalid grant type', 400)
    })
    .post('/auth/v1/logout', async ({ headers }) => {
      const authHeader = headers.authorization
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7).trim()
        await auth.api
          .signOut({ headers: new Headers({ Authorization: `Bearer ${token}` }) })
          .catch(() => {})
      }
      return {}
    })
    .get('/auth/v1/user', async ({ headers, set }) => {
      const authHeader = headers.authorization
      if (!authHeader?.startsWith('Bearer ')) {
        set.status = 401
        return { message: 'Invalid authorization header' }
      }
      const token = authHeader.slice(7).trim()
      if (!token) {
        set.status = 401
        return { message: 'Invalid authorization header' }
      }
      // better-auth's getSession is cookie-based, so we query the DB directly
      try {
        const row = await lookupSessionByToken(auth, token)
        if (!row) {
          set.status = 401
          return { message: 'Invalid token' }
        }
        return bridgeGetUserResponse({ user: row, session: {} })
      } catch {
        set.status = 401
        return { message: 'Invalid authorization header' }
      }
    })
}
