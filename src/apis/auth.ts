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
import { authStore, type RefreshTokenDb } from './auth-store'
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

/** Copy better-auth set-cookie headers onto the Elysia response. */
function forwardSessionCookies(
  headers: Headers,
  set: { headers: Record<string, string | string[]> },
): void {
  // Headers.entries() comma-joins multiple Set-Cookie headers into one
  // string, which browsers mis-parse at the Expires comma. getSetCookie()
  // preserves each cookie separately.
  const setCookies = headers.getSetCookie()
  if (setCookies.length === 1) set.headers['set-cookie'] = setCookies[0] as string
  else if (setCookies.length > 1) set.headers['set-cookie'] = setCookies
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

export const authPlugin = new Elysia({ name: 'sinopebase-auth-fallback' })
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

      // Issue tokens with session and family tracking
      const sessionId = generateSessionId()
      const tokenId = generateTokenId()
      const familyId = generateFamilyId()

      const accessToken = await generateAccessToken(user, sessionId)
      const refreshToken = await generateRefreshToken(user.id, sessionId, tokenId, familyId)

      authStore.addRefreshToken(tokenId, user.id, sessionId, familyId)

      return sessionResponse(user, accessToken, refreshToken)
    },
    {
      detail: {
        tags: ['Auth'],
        summary: 'Sign up with email and password',
        description:
          'Creates a new user account and returns an access token, refresh token, and user profile. Passwords are hashed with bcrypt via Bun.password.',
      },
    },
  )

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

  .get('/auth/v1/session', async ({ headers }) => {
    const authHeader = headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return { data: { session: null, user: null }, error: null }
    }
    const token = authHeader.slice(7).trim()
    if (!token) {
      return { data: { session: null, user: null }, error: null }
    }
    try {
      const payload = await verifyAccessToken(token)
      const storedUser = authStore.findUserById(payload.sub)
      if (!storedUser) {
        return { data: { session: null, user: null }, error: null }
      }
      const user = authStore.toUser(storedUser)
      const now2 = Math.floor(Date.now() / 1000)
      const session = {
        access_token: token,
        token_type: 'bearer' as const,
        expires_in: ACCESS_TOKEN_TTL,
        expires_at: now2 + ACCESS_TOKEN_TTL,
        refresh_token: token,
        user,
      }
      return { data: { session, user }, error: null }
    } catch {
      return { data: { session: null, user: null }, error: null }
    }
  })
  .patch('/auth/v1/user', async ({ headers, body, set }) => {
    const authHeader = headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      set.status = 401
      return { message: 'Invalid authorization header' }
    }
    const token = authHeader.slice(7).trim()
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
      return { message: 'Invalid token' }
    }
    const { email, password, data, currentPassword } = body as {
      email?: string
      password?: string
      data?: Record<string, unknown>
      currentPassword?: string
    }
    // Require current password to change password
    if (password && !currentPassword) {
      set.status = 400
      return { message: 'currentPassword is required to change password' }
    }
    if (password && currentPassword) {
      const valid = await Bun.password.verify(currentPassword, storedUser.passwordHash)
      if (!valid) {
        set.status = 400
        return { message: 'Current password is incorrect' }
      }
      storedUser.passwordHash = await Bun.password.hash(password)
    }
    if (email) storedUser.email = email
    if (data) storedUser.user_metadata = { ...(storedUser.user_metadata ?? {}), ...data }
    const user = authStore.toUser(storedUser)
    return userResponse(user)
  })
  .post('/auth/v1/reset-password', async ({ body }) => {
    const { email } = body as { email?: string }
    // In-memory mode: silently accept (no email sender configured)
    // Return success even for missing email to prevent enumeration
    if (!email) return {}
    // Log the intent — actual email sending requires SMTP
    console.info(`[auth] Password reset requested for ${email} (no-op in memory mode)`)
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
      returnHeaders: true
    }): Promise<{ headers: Headers; response: BetterAuthSignInResult }>
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

export function createAuthPlugin(auth: BetterAuthInstance, oauthProviderIds?: string[]) {
  // Map known provider IDs to display labels and colors.
  // Source of truth: BUILTIN_SOCIAL from auth-better.
  const PROVIDER_LABELS: Record<string, { label: string; color: string }> = {
    google: { label: 'Google', color: '#4285F4' },
    github: { label: 'GitHub', color: '#24292e' },
    discord: { label: 'Discord', color: '#5865F2' },
    apple: { label: 'Apple', color: '#000000' },
    microsoft: { label: 'Microsoft', color: '#00A4EF' },
    spotify: { label: 'Spotify', color: '#1DB954' },
    gitlab: { label: 'GitLab', color: '#FC6D26' },
    bitbucket: { label: 'Bitbucket', color: '#0052CC' },
    twitch: { label: 'Twitch', color: '#9146FF' },
    twitter: { label: 'Twitter', color: '#1DA1F2' },
    linkedin: { label: 'LinkedIn', color: '#0A66C2' },
    dropbox: { label: 'Dropbox', color: '#0061FF' },
  }

  return (
    new Elysia({ name: 'sinopebase-auth' })
      // List configured OAuth providers for the admin UI login page.
      // Must be registered before the better-auth catch-all below.
      .get('/api/auth/oauth-providers', () => {
        const providers = (oauthProviderIds ?? []).map((id) => {
          const meta = PROVIDER_LABELS[id]
          return meta
            ? { id, label: meta.label, color: meta.color }
            : { id, label: id.charAt(0).toUpperCase() + id.slice(1), color: '#666' }
        })
        return { providers }
      })
      // better-auth's sign-in/social is POST-only, but supabase-js's
      // signInWithOAuth contract hands the browser a URL to navigate to.
      // Accept GET here and proxy better-auth's POST internally.
      .get('/api/auth/sign-in/social', async ({ query, set }) => {
        const q = query as Record<string, string>
        const body: Record<string, string> = { provider: q.provider ?? '' }
        if (q.callbackURL) body.callbackURL = q.callbackURL
        const upstream = await (
          auth as unknown as { handler: (req: Request) => Promise<Response> }
        ).handler(
          new Request('http://internal/api/auth/sign-in/social', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
        )
        set.status = upstream.status
        for (const [key, value] of upstream.headers) {
          if (key.toLowerCase() !== 'content-length' && key.toLowerCase() !== 'set-cookie') {
            set.headers[key] = value
          }
        }
        forwardSessionCookies(upstream.headers, set)
        return upstream.json().catch(() => null)
      })
      // better-auth's own handler for /api/auth/* endpoints. The original
      // request is passed unchanged — Elysia's .mount() strips the path
      // prefix, which made every better-auth route 404 because its router
      // matches against the full basePath (/api/auth).
      .all('/api/auth', ({ request }) =>
        (auth as unknown as { handler: (req: Request) => Promise<Response> }).handler(request),
      )
      .all('/api/auth/*', async ({ request, set }) => {
        const upstream = await (
          auth as unknown as { handler: (req: Request) => Promise<Response> }
        ).handler(request)
        // Unresolvable OIDC issuers crash better-auth's discovery fetch with
        // an empty 500 — surface a defined error instead.
        if (upstream.status >= 500 && new URL(request.url).pathname.includes('sign-in/social')) {
          set.status = 400
          return {
            code: 'INVALID_OAUTH_CONFIGURATION',
            message: 'OAuth provider configuration is invalid or unreachable.',
          }
        }
        set.status = upstream.status
        for (const [key, value] of upstream.headers) {
          if (key.toLowerCase() !== 'content-length' && key.toLowerCase() !== 'set-cookie') {
            set.headers[key] = value
          }
        }
        forwardSessionCookies(upstream.headers, set)
        return upstream.body ? upstream.json().catch(() => null) : null
      })
      // POST /api/auth/exchange — exchange better-auth session cookie for Bearer token
      .post('/api/auth/exchange', async ({ request, set }) => {
        // CSRF defense: require a custom header that cross-origin JS cannot set
        // without a CORS preflight (which the server denies for non-trusted origins).
        if (request.headers.get('x-requested-with') !== 'sinopebase-admin') {
          set.status = 403
          return { code: 403, message: 'CSRF protection: missing X-Requested-With header' }
        }

        // Extract the better-auth session cookie
        const cookieHeader = request.headers.get('cookie') ?? ''
        const match = /better-auth\.session_token=([^;]+)/.exec(cookieHeader)
        const sessionToken = match?.[1]
        if (!sessionToken) {
          set.status = 401
          return { code: 401, message: 'No active session' }
        }

        try {
          const session = await lookupSessionByToken(
            auth as unknown as Record<string, unknown>,
            sessionToken,
          )
          if (!session) {
            set.status = 401
            return { code: 401, message: 'Session expired or invalid' }
          }

          // Return the session token itself as the Bearer token (same pattern as bridgeSignInResponse)
          const now = Math.floor(Date.now() / 1000)
          const expiresIn = ACCESS_TOKEN_TTL
          return {
            access_token: sessionToken,
            token_type: 'bearer',
            expires_in: expiresIn,
            expires_at: now + expiresIn,
            refresh_token: sessionToken,
            user: {
              id: session.id,
              email: session.email,
              role: session.role,
              aud: 'authenticated',
              app_metadata: {},
              user_metadata: { name: session.name, image: session.image },
              created_at: session.createdAt.toISOString(),
              updated_at: session.updatedAt.toISOString(),
            },
          }
        } catch {
          set.status = 401
          return { code: 401, message: 'Failed to validate session' }
        }
      })
      // GET /auth/v1/session — read session from better-auth cookie (SSR support)
      .get('/auth/v1/session', async ({ request }) => {
        const cookieHeader = request.headers.get('cookie') ?? ''
        const match = /better-auth\.session_token=([^;]+)/.exec(cookieHeader)
        const sessionToken = match?.[1]
        if (!sessionToken) {
          return { data: { session: null, user: null }, error: null }
        }
        try {
          const row = await lookupSessionByToken(
            auth as unknown as Record<string, unknown>,
            sessionToken,
          )
          if (!row) {
            return { data: { session: null, user: null }, error: null }
          }
          const session = bridgeSignInResponse({ token: sessionToken, user: row })
          if ('message' in session) {
            return { data: { session: null, user: null }, error: null }
          }
          return { data: { session, user: session.user }, error: null }
        } catch {
          return { data: { session: null, user: null }, error: null }
        }
      })
      .post('/auth/v1/signup', async ({ body, set }) => {
        const { email, password } = body as { email: string; password: string }
        if (!email || !password) {
          set.status = 400
          return errorResponse('Email and password are required', 400)
        }
        try {
          // Sign up via better-auth, then sign in to get a session token.
          // returnHeaders captures better-auth's session cookie so
          // cookie-based flows (session exchange, admin UI login) work.
          await auth.api.signUpEmail({ body: { email, password, name: '' } })
          const signIn = await auth.api.signInEmail({
            body: { email, password },
            returnHeaders: true,
          })
          forwardSessionCookies(signIn.headers, set)
          const signInResult = signIn.response
          // Store initial refresh token entry for rotation tracking
          await persistRefreshTokenOnSignIn(auth, signInResult)
          return bridgeSignInResponse(signInResult)
        } catch (err: unknown) {
          set.status = 400
          return errorResponse(err instanceof Error ? err.message : 'Signup failed', 400)
        }
      })
      .post('/auth/v1/token', async ({ body, query, set, request }) => {
        const q = query as Record<string, string>
        const grantType = q.grant_type
        if (grantType === 'password') {
          const { email, password } = body as { email: string; password: string }
          if (!email || !password) {
            set.status = 400
            return errorResponse('Invalid login credentials', 400)
          }
          try {
            const signIn = await auth.api.signInEmail({
              body: { email, password },
              returnHeaders: true,
            })
            forwardSessionCookies(signIn.headers, set)
            const result = signIn.response
            // Store initial refresh token entry for rotation tracking
            await persistRefreshTokenOnSignIn(auth, result)
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
            const db = (auth as Record<string, unknown>).__db
            if (!db) {
              // No DB available — cannot perform rotation
              set.status = 400
              return errorResponse('Invalid refresh token', 400)
            }

            // 1. Look up refresh token in the dedicated table
            const typedDb = db as RefreshTokenDb

            const tokenRows = await typedDb
              .selectFrom('refresh_tokens')
              .selectAll()
              .where('token_id', '=', refresh_token)
              .execute()

            // Fallback: if no refresh_tokens entry exists, check session table directly
            // (supports sessions created before the refresh_tokens table existed)
            if (!tokenRows[0]) {
              const row = await lookupSessionByToken(auth, refresh_token)
              if (!row) {
                set.status = 400
                return errorResponse('Invalid refresh token', 400)
              }
              // Legacy rotation: update session token directly
              const newToken = crypto.randomUUID().replace(/-/g, '')
              const sessions = await typedDb
                .selectFrom('session')
                .select(['id'])
                .where('token', '=', refresh_token)
                .execute()
              const sessionId = (sessions[0] as Record<string, unknown> | undefined)?.id as
                | string
                | undefined
              if (sessionId) {
                await typedDb
                  .updateTable('session')
                  .set({ token: newToken, updatedAt: new Date() } as Record<string, unknown>)
                  .where('id', '=', sessionId)
                  .execute()
              }
              return bridgeSignInResponse({ token: newToken, user: row } as BetterAuthSignInResult)
            }

            const tokenRecord = tokenRows[0] as Record<string, unknown>
            const tokenId = tokenRecord.token_id as string
            const userId = tokenRecord.user_id as string
            const sessionId = tokenRecord.session_id as string
            const familyId = tokenRecord.family_id as string
            const consumed = tokenRecord.consumed as boolean
            const compromised = tokenRecord.compromised as boolean
            const expiresAt = tokenRecord.expires_at as Date

            // 2. Check expiry
            if (expiresAt < new Date()) {
              set.status = 400
              return errorResponse('Invalid refresh token', 400)
            }

            // 3. Check compromised flag
            if (compromised) {
              set.status = 400
              return errorResponse('Invalid refresh token', 400)
            }

            // 4. Check consumed flag — REPLAY DETECTION
            if (consumed) {
              // Mark entire family as compromised
              await typedDb
                .updateTable('refresh_tokens')
                .set({ compromised: true } as Record<string, unknown>)
                .where('family_id', '=', familyId)
                .execute()
              // Log audit event
              console.error(
                `[AUDIT] Refresh token replay detected: token_id=${tokenId}, family=${familyId}, user=${userId}`,
              )
              set.status = 400
              return errorResponse('Invalid refresh token', 400)
            }

            // 5. Look up session to get user info
            const sessions = await typedDb
              .selectFrom('session')
              .select(['userId'])
              .where('id', '=', sessionId)
              .execute()
            const sessionUserId = (sessions[0] as Record<string, unknown> | undefined)?.userId as
              | string
              | undefined
            if (!sessionUserId) {
              set.status = 400
              return errorResponse('Invalid refresh token', 400)
            }

            // 6. Mark old token as consumed
            await typedDb
              .updateTable('refresh_tokens')
              .set({ consumed: true } as Record<string, unknown>)
              .where('token_id', '=', tokenId)
              .execute()

            // 7. Generate new tokens
            const newToken = crypto.randomUUID().replace(/-/g, '')
            const newRefreshTokenId = crypto.randomUUID().replace(/-/g, '')

            // Update session token
            await typedDb
              .updateTable('session')
              .set({ token: newToken, updatedAt: new Date() } as Record<string, unknown>)
              .where('id', '=', sessionId)
              .execute()

            // Create new refresh token record
            const expiresAtDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
            await typedDb
              .insertInto('refresh_tokens')
              .values({
                token_id: newRefreshTokenId,
                user_id: userId,
                session_id: sessionId,
                family_id: familyId,
                parent_token_id: tokenId,
                consumed: false,
                compromised: false,
                expires_at: expiresAtDate,
                created_at: new Date(),
              } as Record<string, unknown>)
              .execute()

            // 8. Return new session with tokens
            const userRow = await lookupSessionByToken(auth, newToken)
            return bridgeSignInResponse({
              token: newToken,
              user: userRow,
            } as BetterAuthSignInResult)
          } catch {
            set.status = 400
            return errorResponse('Invalid refresh token', 400)
          }
        }
        if (grantType === 'authorization_code') {
          // OAuth callback: the code was already consumed by better-auth's
          // /api/auth/callback handler. Just read the session cookie that
          // better-auth set during the callback redirect.
          try {
            const cookieHeader = request.headers.get('cookie') ?? ''
            const match = /better-auth\.session_token=([^;]+)/.exec(cookieHeader)
            const sessionToken = match?.[1]
            if (!sessionToken) {
              set.status = 400
              return errorResponse('Invalid authorization code', 400)
            }
            const row = await lookupSessionByToken(
              auth as unknown as Record<string, unknown>,
              sessionToken,
            )
            if (!row) {
              set.status = 400
              return errorResponse('Invalid authorization code', 400)
            }
            const result = bridgeSignInResponse({ token: sessionToken, user: row })
            if ('message' in result) {
              set.status = 400
              return result
            }
            // Store refresh token entry so rotation works
            await persistRefreshTokenOnSignIn(auth, {
              token: sessionToken,
              user: { id: result.user.id },
            })
            return result
          } catch {
            set.status = 400
            return errorResponse('Invalid authorization code', 400)
          }
        }
        set.status = 400
        return errorResponse('Invalid grant type', 400)
      })
      .post('/auth/v1/logout', async ({ headers }) => {
        const authHeader = headers.authorization
        if (authHeader?.startsWith('Bearer ')) {
          const token = authHeader.slice(7).trim()
          const api = auth.api as unknown as {
            signOut: (args: { headers: Headers }) => Promise<void>
            revokeSession: (args: { body: { token: string } }) => Promise<void>
          }
          // Revoke the session server-side — signOut alone is cookie-keyed
          // and does not invalidate Bearer sessions.
          await api.revokeSession({ body: { token } }).catch(() => {})
          await api
            .signOut({ headers: new Headers({ Authorization: `Bearer ${token}` }) })
            .catch(() => {})
        }
        return {}
      })
      .patch('/auth/v1/user', async ({ headers, body, set }) => {
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
        try {
          const row = await lookupSessionByToken(auth, token)
          if (!row) {
            set.status = 401
            return { message: 'Invalid token' }
          }
          const { email, password, data, currentPassword } = body as {
            email?: string
            password?: string
            data?: Record<string, unknown>
            currentPassword?: string
          }
          // Require current password verification before changing password
          // (better-auth freshness: prevents stolen session token from silently changing password)
          if (password && !currentPassword) {
            set.status = 400
            return { message: 'currentPassword is required to change password' }
          }
          const typedDb = (auth as Record<string, unknown>).__db as RefreshTokenDb | undefined
          try {
            if (password && currentPassword) {
              // Verify current password before allowing change
              const userRows = await typedDb
                ?.selectFrom('user')
                .select(['password'])
                .where('id', '=', row.id)
                .execute()
              const storedHash = (userRows?.[0] as Record<string, unknown> | undefined)?.password as
                | string
                | undefined
              if (!storedHash || !(await Bun.password.verify(currentPassword, storedHash))) {
                set.status = 400
                return { message: 'Current password is incorrect' }
              }
              const hashedPassword = await Bun.password.hash(password)
              if (typedDb?.updateTable) {
                await typedDb
                  .updateTable('user')
                  .set({ password: hashedPassword, updatedAt: new Date() } as Record<
                    string,
                    unknown
                  >)
                  .where('id', '=', row.id)
                  .execute()
              }
            }
            if (typedDb?.updateTable) {
              const updateData: Record<string, unknown> = { updatedAt: new Date() }
              if (data) updateData.user_metadata = data
              if (email) updateData.email = email
              await typedDb.updateTable('user').set(updateData).where('id', '=', row.id).execute()
            }
            // Return updated user
            const updated = await lookupSessionByToken(auth, token)
            if (updated) {
              return bridgeGetUserResponse({ user: updated, session: {} })
            }
            return bridgeGetUserResponse({ user: row, session: {} })
          } catch {
            // Fallback: return current user even if update partially failed
            return bridgeGetUserResponse({ user: row, session: {} })
          }
        } catch {
          set.status = 401
          return { message: 'Invalid authorization header' }
        }
      })
      .post('/auth/v1/reset-password', async ({ body }) => {
        const { email } = body as { email?: string }
        if (!email) {
          // Return success even for missing email to prevent enumeration
          return {}
        }
        // Trigger better-auth password reset
        try {
          const ba = auth as unknown as {
            api?: { requestPasswordReset?: (args: { body: { email: string } }) => Promise<void> }
          }
          await ba.api?.requestPasswordReset?.({ body: { email } })
        } catch {
          // Swallow errors — always return success to prevent email enumeration
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
  )
}

// ---------------------------------------------------------------------------
// Refresh token persistence helper
// ---------------------------------------------------------------------------

/**
 * After a successful sign-in (or sign-up + sign-in), store an initial
 * refresh token entry in the `refresh_tokens` table so the rotation
 * and replay-detection flow works for this session.
 */
async function persistRefreshTokenOnSignIn(
  auth: BetterAuthInstance,
  signInResult: { token: string; user: { id: string } },
): Promise<void> {
  const typedDb = (auth as Record<string, unknown>).__db as RefreshTokenDb | undefined
  if (!typedDb?.selectFrom) return

  try {
    const sessions = await typedDb
      .selectFrom('session')
      .select(['id'])
      .where('token', '=', signInResult.token)
      .execute()
    if (!sessions[0]) return

    const sessionId = sessions[0].id as string
    const newRefreshTokenId = crypto.randomUUID().replace(/-/g, '')
    const familyId = crypto.randomUUID().replace(/-/g, '')

    await typedDb
      .insertInto('refresh_tokens')
      .values({
        token_id: newRefreshTokenId,
        user_id: signInResult.user.id,
        session_id: sessionId,
        family_id: familyId,
        parent_token_id: null,
        consumed: false,
        compromised: false,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        created_at: new Date(),
      } as Record<string, unknown>)
      .execute()
  } catch {
    // Non-fatal — refresh token storage is best-effort during sign-in
  }
}
