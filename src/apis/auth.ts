/**
 * Auth API routes — Supabase-compatible /auth/v1/* endpoints.
 *
 * Implements the same response shapes as supabase-js GoTrue client expects.
 * Uses jose for JWT generation/verification and an in-memory store for users.
 */

import { Elysia } from 'elysia'
import { authStore } from './auth-store'
import {
  generateAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  ACCESS_TOKEN_EXPIRES_IN,
} from './auth-jwt'
import { bridgeSignInResponse, bridgeGetUserResponse, bridgeErrorResponse } from '~/tools/auth-better/supabase-bridge'
import { lookupSessionByToken } from '~/tools/auth-better'

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
    data: {
      user,
      session: {
        access_token: accessToken,
        token_type: 'bearer' as const,
        expires_in: ACCESS_TOKEN_EXPIRES_IN,
        expires_at: now + ACCESS_TOKEN_EXPIRES_IN,
        refresh_token: refreshToken,
        user,
      },
    },
    error: null,
  }
}

function errorResponse(message: string, status: number) {
  return {
    data: { user: null, session: null },
    error: { message, status },
  }
}

function userResponse(user: ReturnType<typeof authStore.toUser>) {
  return {
    data: { user },
    error: null,
  }
}

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------

export const authPlugin = new Elysia()
  .post(
    '/auth/v1/signup',
    async ({ body, set }) => {
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

      const accessToken = await generateAccessToken(user)
      const refreshToken = generateRefreshToken()

      authStore.addRefreshToken(refreshToken, user.id)

      return sessionResponse(user, accessToken, refreshToken)
    },
  )

  .post(
    '/auth/v1/token',
    async ({ body, query, set }) => {
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

        const valid = await Bun.password.verify(
          password,
          storedUser.passwordHash,
        )
        if (!valid) {
          set.status = 400
          return errorResponse('Invalid login credentials', 400)
        }

        authStore.updateLastSignIn(storedUser.id)
        const user = authStore.toUser(storedUser)

        const accessToken = await generateAccessToken(user)
        const refreshToken = generateRefreshToken()

        authStore.addRefreshToken(refreshToken, user.id)

        return sessionResponse(user, accessToken, refreshToken)
      }

      if (grantType === 'refresh_token') {
        // Refresh session
        const { refresh_token } = body as { refresh_token?: string }

        if (!refresh_token) {
          set.status = 400
          return errorResponse('Invalid refresh token', 400)
        }

        const data = authStore.consumeRefreshToken(refresh_token)
        if (!data) {
          set.status = 400
          return errorResponse('Invalid refresh token', 400)
        }

        const storedUser = authStore.findUserById(data.userId)
        if (!storedUser) {
          set.status = 400
          return errorResponse('Invalid refresh token', 400)
        }

        const user = authStore.toUser(storedUser)
        const accessToken = await generateAccessToken(user)
        const newRefreshToken = generateRefreshToken()

        authStore.addRefreshToken(newRefreshToken, user.id)

        return sessionResponse(user, accessToken, newRefreshToken)
      }

      // Unknown grant type
      set.status = 400
      return errorResponse('Invalid grant type', 400)
    },
  )

  .post(
    '/auth/v1/logout',
    async ({ headers }) => {
      // Invalidate the user's refresh tokens if a Bearer token is provided
      const authHeader = headers.authorization
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7).trim()
        if (token) {
          try {
            const payload = await verifyAccessToken(token)
            authStore.removeAllRefreshTokensForUser(payload.sub)
          } catch {
            // Token invalid — still acknowledge logout
          }
        }
      }
      return { error: null }
    },
  )

  .get(
    '/auth/v1/user',
    async ({ headers, set }) => {
      const authHeader = headers.authorization
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
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
    },
  )

export { sessionResponse, userResponse, errorResponse }

export function createAuthPlugin(auth: any) {
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
      } catch (err: any) {
        set.status = 400
        return errorResponse(err?.message || 'Signup failed', 400)
      }
    })
    .post('/auth/v1/token', async ({ body, query, set }) => {
      const grantType = (query as any)?.grant_type as string | undefined
      if (grantType === 'password') {
        const { email, password } = body as { email: string; password: string }
        if (!email || !password) {
          set.status = 400
          return errorResponse('Invalid login credentials', 400)
        }
        try {
          const result = await auth.api.signInEmail({ body: { email, password } })
          return bridgeSignInResponse(result)
        } catch (err: any) {
          set.status = 400
          return errorResponse(err?.message || 'Invalid login credentials', 400)
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
          const db = (auth as any).__db
          const newToken = crypto.randomUUID().replace(/-/g, '')
          const sessionId = (await db
            .selectFrom('session')
            .select('session.id')
            .where('session.token', '=', refresh_token)
            .execute())[0]?.id
          if (sessionId) {
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
        await auth.api.signOut({ headers: new Headers({ Authorization: 'Bearer ' + token }) }).catch(() => {})
      }
      return { error: null }
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
        const response = bridgeGetUserResponse({ user: row })
        if (response.error) {
          set.status = response.error.status
        }
        return response
      } catch {
        set.status = 401
        return { message: 'Invalid authorization header' }
      }
    })
}
