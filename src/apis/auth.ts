/**
 * Auth API routes — Supabase-compatible /auth/v1/* endpoints.
 *
 * Implements the same response shapes as supabase-js GoTrue client expects.
 * Uses jose for JWT generation/verification and an in-memory store for users.
 *
 * v2: Refresh token rotation with family-based replay detection.
 */

import { Elysia } from 'elysia'
import type { Kysely } from 'kysely'
import { z } from 'zod'
import { lookupSessionByToken, type SessionLookup } from '~/tools/auth-better'
import type { BetterAuthDatabase } from '~/tools/auth-better/adapter'
import {
  exchangeRefreshToken,
  LOGOUT_SCOPES,
  refreshTokenForSession,
  revokeSessions,
} from '~/tools/auth-better/refresh-tokens'
import { signupsAllowed } from '~/tools/auth-better/signup-policy'
import {
  type BetterAuthGetSessionResult,
  type BetterAuthSignInResult,
  bridgeGetUserResponse,
  bridgeSignInResponse,
} from '~/tools/auth-better/supabase-bridge'
import { createAdminUsersPlugin } from './admin-users'
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
  set: { headers: Record<string, string | string[] | number | undefined> },
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

// Keep direct Supabase-compatible signup closed in production. Existing users
// can still sign in; local development remains open unless explicitly disabled.
export { signupsAllowed }

function nativeSignupBlocked(request: Request): boolean {
  if (signupsAllowed()) return false
  const path = new URL(request.url).pathname
  return path.startsWith('/api/auth/sign-up/')
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

      if (!signupsAllowed()) {
        set.status = 403
        return errorResponse('Signups are currently invite-only.', 403)
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

/**
 * Resolve a browser session through Better Auth, which verifies its signed
 * session-cookie format before returning the backing session row.  The raw
 * cookie value is not necessarily the database session token (signed cookies
 * append a signature), so it must never be queried directly.
 */
async function getValidatedCookieSession(
  auth: BetterAuthInstance,
  headers: HeadersInit,
): Promise<BetterAuthGetSessionResult | null> {
  try {
    return await auth.api.getSession({ headers: new Headers(headers) })
  } catch {
    return null
  }
}

function getSessionToken(result: BetterAuthGetSessionResult | null): string | null {
  const token = result?.session.token
  return typeof token === 'string' && token.length > 0 ? token : null
}

/** The better-auth Kysely handle attached by `createAuth`. */
function authDb(auth: BetterAuthInstance): Kysely<BetterAuthDatabase> {
  return auth.__db as unknown as Kysely<BetterAuthDatabase>
}

const refreshGrantBody = z.object({ refresh_token: z.string().min(1) })
const logoutScope = z.enum(LOGOUT_SCOPES)

/** A GoTrue session for a better-auth sign-in: session token + opaque refresh token. */
async function issueSession(auth: BetterAuthInstance, result: BetterAuthSignInResult) {
  return bridgeSignInResponse(result, await refreshTokenForSession(authDb(auth), result.token))
}

interface GrantContext {
  body: unknown
  set: { status?: number | string; headers: Record<string, string | string[] | number | undefined> }
  request: Request
}

async function passwordGrant(auth: BetterAuthInstance, { body, set }: GrantContext) {
  const { email, password } = body as { email: string; password: string }
  try {
    const signIn = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true })
    forwardSessionCookies(signIn.headers, set)
    return await issueSession(auth, signIn.response)
  } catch {
    // GoTrue's message for any failed password sign-in; never better-auth or database text.
    set.status = 400
    return errorResponse('Invalid login credentials', 400)
  }
}

async function refreshTokenGrant(auth: BetterAuthInstance, { body, set }: GrantContext) {
  // Database errors propagate to the global handler (masked 500), as in GoTrue.
  const parsed = refreshGrantBody.safeParse(body)
  const pair = parsed.success
    ? await exchangeRefreshToken(authDb(auth), parsed.data.refresh_token)
    : null
  if (!pair) {
    set.status = 400
    return errorResponse('Invalid refresh token', 400)
  }
  // The exchange just read this live session; only a concurrent logout can
  // remove it, and then the bridge throws (500) rather than returning 200.
  const user = (await lookupSessionByToken(auth, pair.accessToken)) as SessionLookup
  return bridgeSignInResponse({ token: pair.accessToken, user }, pair.refreshToken)
}

/**
 * OAuth callback: the code was already consumed by better-auth's
 * /api/auth/callback handler. Read the session cookie that better-auth set
 * during the callback redirect.
 */
async function authorizationCodeGrant(auth: BetterAuthInstance, { set, request }: GrantContext) {
  const validatedSession = await getValidatedCookieSession(auth, request.headers)
  const sessionToken = getSessionToken(validatedSession)
  if (!sessionToken) {
    set.status = 400
    return errorResponse('Invalid authorization code', 400)
  }
  // A session token implies Better Auth returned the session with its user.
  const { user } = validatedSession as BetterAuthGetSessionResult
  return issueSession(auth, { token: sessionToken, user })
}

const TOKEN_GRANTS = new Map([
  ['password', passwordGrant],
  ['refresh_token', refreshTokenGrant],
  ['authorization_code', authorizationCodeGrant],
])

export function createAuthPlugin(
  auth: BetterAuthInstance,
  oauthProviderIds?: string[],
  serviceKey?: string,
) {
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
      .use(createAdminUsersPlugin(authDb(auth), serviceKey))
      .onBeforeHandle(({ request, set }) => {
        if (!nativeSignupBlocked(request)) return
        set.status = 403
        return errorResponse('Signups are currently invite-only.', 403)
      })
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

        const result = await getValidatedCookieSession(auth, request.headers)
        const sessionToken = getSessionToken(result)
        if (!sessionToken || !result?.user) {
          set.status = 401
          return { code: 401, message: 'No active session' }
        }

        try {
          // Return the session token itself as the Bearer token (same pattern as bridgeSignInResponse)
          const now = Math.floor(Date.now() / 1000)
          const expiresIn = ACCESS_TOKEN_TTL
          return {
            access_token: sessionToken,
            token_type: 'bearer',
            expires_in: expiresIn,
            expires_at: now + expiresIn,
            refresh_token: await refreshTokenForSession(authDb(auth), sessionToken),
            user: {
              id: result.user.id,
              email: result.user.email,
              role: result.user.role,
              aud: 'authenticated',
              app_metadata: {},
              user_metadata: { name: result.user.name, image: result.user.image },
              created_at: result.user.createdAt.toISOString(),
              updated_at: result.user.updatedAt.toISOString(),
            },
          }
        } catch {
          set.status = 401
          return { code: 401, message: 'Failed to validate session' }
        }
      })
      // GET /auth/v1/session — read session from better-auth cookie (SSR support)
      .get('/auth/v1/session', async ({ request }) => {
        const result = await getValidatedCookieSession(auth, request.headers)
        const sessionToken = getSessionToken(result)
        if (!sessionToken || !result?.user) {
          return { data: { session: null, user: null }, error: null }
        }
        const session = await issueSession(auth, { token: sessionToken, user: result.user })
        return { data: { session, user: session.user }, error: null }
      })
      .post('/auth/v1/signup', async ({ body, set }) => {
        const { email, password } = body as { email: string; password: string }
        if (!signupsAllowed()) {
          set.status = 403
          return errorResponse('Signups are currently invite-only.', 403)
        }
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
          return await issueSession(auth, signIn.response)
        } catch (err: unknown) {
          set.status = 400
          return errorResponse(err instanceof Error ? err.message : 'Signup failed', 400)
        }
      })
      .post('/auth/v1/token', ({ body, query, set, request }) => {
        const grant = TOKEN_GRANTS.get((query as Record<string, string>).grant_type as string)
        if (!grant) {
          set.status = 400
          return errorResponse('Invalid grant type', 400)
        }
        return grant(auth, { body, set, request })
      })
      // GoTrue logout: revoke sessions for the Bearer token's user, 204 No Content.
      // Errors surface as 500 (not swallowed) so a failed revocation never reports success.
      .post('/auth/v1/logout', async ({ headers, query, set }) => {
        const scope = logoutScope.safeParse((query as Record<string, string>).scope ?? 'global')
        if (!scope.success) {
          set.status = 400
          return errorResponse('Unsupported logout scope', 400)
        }
        // GoTrue: no Bearer token → 401; a token without a live session → 403.
        const bearer = headers.authorization
        if (!bearer?.startsWith('Bearer ')) {
          set.status = 401
          return errorResponse('This endpoint requires a valid Bearer token', 401)
        }
        if (!(await revokeSessions(authDb(auth), bearer.slice(7), scope.data))) {
          set.status = 403
          return errorResponse('Session not found', 403)
        }
        return new Response(null, { status: 204 })
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
