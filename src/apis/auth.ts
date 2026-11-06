/**
 * Auth API routes — Supabase-compatible /auth/v1/* endpoints.
 *
 * Implements the same response shapes as supabase-js GoTrue client expects.
 * Uses jose for JWT generation/verification and an in-memory store for users.
 *
 * v2: Refresh token rotation with family-based replay detection.
 */

import { Elysia } from 'elysia'
import { type Kysely, sql, type Transaction } from 'kysely'
import { z } from 'zod'
import {
  type EmailChangeMailer,
  lookupSessionByToken,
  type SessionLookup,
  type SinopebaseAuth,
} from '~/tools/auth-better'
import type { BetterAuthDatabase } from '~/tools/auth-better/adapter'
import { REAUTHENTICATION_WINDOW_MS, tombstoneUser } from '~/tools/auth-better/delete-user'
import {
  consumeEmailChange,
  dropEmailChange,
  pendingEmailChange,
  recentEmailChange,
  retireEmailChanges,
  stageEmailChange,
} from '~/tools/auth-better/email-change'
import { removeSignInMethod } from '~/tools/auth-better/identity-linking-policy'
import {
  RECOVERY_EMAIL_PREFIX,
  RESET_PREFIX,
  retireRecoveryLinks,
} from '~/tools/auth-better/recovery-links'
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
import { createAdminUsersPlugin, type DeliverMail } from './admin-users'
import {
  ACCESS_TOKEN_TTL,
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from './auth-jwt'
import {
  authorize,
  authorizeLink,
  completeFlow,
  type OAuthFlowAuth,
  pkceGrant,
  signInAccounts,
  startLink,
  toIdentities,
} from './auth-oauth'
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
  // In-memory mode has no mail sender; GoTrue's generic success avoids enumeration.
  .post('/auth/v1/recover', () => ({}))
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
  $context?: Promise<
    Pick<Awaited<SinopebaseAuth['$context']>, 'password' | 'internalAdapter' | 'isTrustedOrigin'>
  >
  api: {
    signUpEmail(args: { body: { email: string; password: string; name: string } }): Promise<void>
    signInEmail(args: {
      body: { email: string; password: string }
      returnHeaders: true
    }): Promise<{ headers: Headers; response: BetterAuthSignInResult }>
    signOut(args: { headers: Headers }): Promise<void>
    getSession(args: { headers: Headers }): Promise<BetterAuthGetSessionResult | null>
    requestPasswordReset?(args: { body: { email: string; redirectTo?: string } }): Promise<unknown>
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
  /** Mails GoTrue email-change links; absent when SMTP is not configured. */
  __mailEmailChange?: EmailChangeMailer
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

function oauthFlowAuth(auth: BetterAuthInstance): OAuthFlowAuth {
  return auth as unknown as OAuthFlowAuth
}

const nativeUserUpdate = z
  .object({
    email: z.string().email().optional(),
    password: z.string().min(1).optional(),
    current_password: z.string().min(1).optional(),
    currentPassword: z.string().min(1).optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (value) =>
      !value.current_password ||
      !value.currentPassword ||
      value.current_password === value.currentPassword,
  )

/** GoTrue error body: supabase-js reads `error_code`/`msg`; Sinopebase's own SDK reads `message`. */
function goTrueError(
  set: { status?: number | string },
  status: number,
  errorCode: string,
  msg: string,
  extra?: Record<string, unknown>,
) {
  set.status = status
  return { code: status, error_code: errorCode, msg, message: msg, ...extra }
}

class UserUpdateRefused extends Error {
  readonly status: number
  readonly errorCode: string
  readonly extra?: Record<string, unknown>
  constructor(status: number, errorCode: string, message: string, extra?: Record<string, unknown>) {
    super(message)
    this.status = status
    this.errorCode = errorCode
    this.extra = extra
  }
}

/** GoTrue amr method of a session created by verifying a recovery link. */
const RECOVERY = 'recovery'

function parseNativeUpdate(body: unknown) {
  const parsed = nativeUserUpdate.safeParse(body)
  if (!parsed.success) throw new UserUpdateRefused(400, 'validation_failed', 'Invalid user update')
  return {
    ...parsed.data,
    currentPassword: parsed.data.current_password ?? parsed.data.currentPassword,
  }
}

async function nativeContext(auth: BetterAuthInstance) {
  const native = await auth.$context
  if (!native) throw new Error('Native auth context unavailable')
  return native
}

function weakPassword(message: string) {
  return new UserUpdateRefused(422, 'weak_password', message, {
    weak_password: { reasons: ['length'] },
  })
}

/** Better Auth's native policy (8–128 by default), reported as GoTrue's weak_password. */
async function nativePasswordProvider(auth: BetterAuthInstance, password: string) {
  const { password: provider } = await nativeContext(auth)
  const { minPasswordLength, maxPasswordLength } = provider.config
  if (password.length < minPasswordLength)
    throw weakPassword(`Password should be at least ${minPasswordLength} characters.`)
  if (password.length > maxPasswordLength)
    throw weakPassword(`Password should be at most ${maxPasswordLength} characters.`)
  return provider
}

type PasswordProvider = Awaited<SinopebaseAuth['$context']>['password']

/** GoTrue UpdatePasswordRequireCurrentPassword, outside a recovery session. */
async function proveCurrentPassword(
  provider: PasswordProvider,
  hash: string | null | undefined,
  currentPassword: string | undefined,
) {
  if (!currentPassword)
    throw new UserUpdateRefused(
      400,
      'current_password_required',
      'Current password required when setting new password.',
    )
  if (!hash || !(await provider.verify({ password: currentPassword, hash })))
    throw new UserUpdateRefused(400, 'current_password_mismatch', 'Current password is incorrect')
}

interface UpdatingSession {
  id: string
  userId: string
  authMethod: string | null
  /** When the session signed in; a refresh never moves it. */
  createdAt: Date
}

/**
 * GoTrue UpdatePassword: other sessions and their refresh tokens end, pending
 * recovery links die, and a recovery session becomes an ordinary one.
 */
async function finishPasswordChange(
  transaction: Transaction<BetterAuthDatabase>,
  session: UpdatingSession,
) {
  await transaction
    .deleteFrom('session')
    .where('userId', '=', session.userId)
    .where('id', '<>', session.id)
    .execute()
  await transaction
    .deleteFrom('refresh_tokens')
    .where('user_id', '=', session.userId)
    .where('session_id', '<>', session.id)
    .execute()
  await retireRecoveryLinks(transaction, session.userId)
  await transaction
    .updateTable('session')
    .set({ authMethod: null })
    .where('id', '=', session.id)
    .execute()
}

/** Write a Better Auth hash; recovery may create the first native credential, as Better Auth's reset does. */
async function storeNativePassword(
  transaction: Transaction<BetterAuthDatabase>,
  userId: string,
  credentialId: string | undefined,
  hash: string,
) {
  if (credentialId) {
    await transaction
      .updateTable('account')
      .set({ password: hash, updatedAt: new Date() })
      .where('id', '=', credentialId)
      .executeTakeFirstOrThrow()
    return
  }
  await sql`INSERT INTO public.account (id, "userId", "providerId", "accountId", password)
    VALUES (${crypto.randomUUID()}, ${userId}, 'credential', ${userId}, ${hash})`.execute(
    transaction,
  )
}

async function updateNativeCredential(
  auth: BetterAuthInstance,
  transaction: Transaction<BetterAuthDatabase>,
  session: UpdatingSession,
  password: string,
  currentPassword: string | undefined,
) {
  const provider = await nativePasswordProvider(auth, password)
  const credential = await transaction
    .selectFrom('account')
    .select(['id', 'password'])
    .where('userId', '=', session.userId)
    .where('providerId', '=', 'credential')
    .forUpdate()
    .executeTakeFirst()
  // As in GoTrue, a user without a password (social sign-in only) sets their first one.
  if (session.authMethod !== RECOVERY && credential?.password)
    await proveCurrentPassword(provider, credential.password, currentPassword)
  if (credential?.password && (await provider.verify({ password, hash: credential.password })))
    throw new UserUpdateRefused(
      422,
      'same_password',
      'New password should be different from the old password.',
    )
  await storeNativePassword(
    transaction,
    session.userId,
    credential?.id,
    await provider.hash(password),
  )
  await finishPasswordChange(transaction, session)
}

function nativeProfileUpdate(metadata: Record<string, unknown>, data?: Record<string, unknown>) {
  const update: Record<string, unknown> = { updatedAt: new Date() }
  if (data) {
    // Supabase merges top-level keys and removes keys explicitly set to null.
    // The caller holds the user lock, preserving concurrent disjoint updates.
    update.userMetadata = Object.fromEntries(
      Object.entries({ ...metadata, ...data }).filter(([, value]) => value !== null),
    )
  }
  return update
}

/** Whether another account already uses the (lower-cased) address. */
async function addressTaken(
  transaction: Transaction<BetterAuthDatabase>,
  email: string,
  userId: string,
) {
  const other = await transaction
    .selectFrom('user')
    .select('id')
    .where(sql<string>`lower(email)`, '=', email)
    .where('id', '<>', userId)
    .executeTakeFirst()
  return other !== undefined
}

/**
 * GoTrue email change: the address stays as it is and a single-use link goes to
 * the new one; POST /auth/v1/verify (type=email_change) applies it. One mail per
 * user per 60 s. An address another account already uses is staged but never
 * mailed, so the response does not reveal that the address has an account
 * (as Better Auth's changeEmail does). The caller holds the user lock.
 */
async function stageAddressChange(
  transaction: Transaction<BetterAuthDatabase>,
  user: { id: string; email: string },
  requested: string,
) {
  if (await recentEmailChange(transaction, user.id))
    throw new UserUpdateRefused(
      429,
      'over_email_send_rate_limit',
      'For security purposes, you can only request this after 60 seconds.',
    )
  const taken = await addressTaken(transaction, requested, user.id)
  const staged = await stageEmailChange(transaction, {
    userId: user.id,
    from: user.email.toLowerCase(),
    to: requested,
  })
  return { ...staged, to: requested, deliver: !taken }
}

/**
 * Lock the caller's user row, then its session row. Every writer here takes
 * the user lock first, so revoking a user's other sessions cannot deadlock
 * with a concurrent update from one of them.
 */
async function lockUpdatingSession(transaction: Transaction<BetterAuthDatabase>, token: string) {
  const owner = await transaction
    .selectFrom('session')
    .select('userId')
    .where('token', '=', token)
    .where('expiresAt', '>', new Date())
    .executeTakeFirst()
  if (!owner) throw new UserUpdateRefused(401, 'session_not_found', 'Invalid token')
  const user = await transaction
    .selectFrom('user')
    .selectAll()
    .where('id', '=', owner.userId)
    .forUpdate()
    .executeTakeFirst()
  // Revalidate the session under the user lock: it may have been revoked meanwhile.
  const session = await transaction
    .selectFrom('session')
    .select(['id', 'userId', 'authMethod', 'createdAt'])
    .where('token', '=', token)
    .where('userId', '=', owner.userId)
    .where('expiresAt', '>', new Date())
    .forUpdate()
    .executeTakeFirst()
  if (!user || !session) throw new UserUpdateRefused(401, 'session_not_found', 'Invalid token')
  return { user, session }
}

async function applyNativeUpdate(
  auth: BetterAuthInstance,
  transaction: Transaction<BetterAuthDatabase>,
  token: string,
  update: ReturnType<typeof parseNativeUpdate>,
) {
  const { user, session } = await lockUpdatingSession(transaction, token)
  if (update.password)
    await updateNativeCredential(
      auth,
      transaction,
      session,
      update.password,
      update.currentPassword,
    )
  const requested = update.email?.toLowerCase()
  const staged =
    requested && requested !== user.email.toLowerCase()
      ? await stageAddressChange(transaction, user, requested)
      : undefined
  const row = await transaction
    .updateTable('user')
    .set(nativeProfileUpdate(user.userMetadata, update.data))
    .where('id', '=', user.id)
    .returningAll()
    .executeTakeFirstOrThrow()
  return { row, staged }
}

/**
 * Mail a staged email change once its transaction committed. An undelivered link
 * is dropped. Without a configured mailer nothing is sent, as for recovery.
 */
async function deliverAddressChange(
  auth: BetterAuthInstance,
  staged: { token: string; to: string },
  redirectTo: string | undefined,
) {
  try {
    await auth.__mailEmailChange?.(staged.to, staged.token, await trustedRedirect(auth, redirectTo))
    return true
  } catch {
    await dropEmailChange(authDb(auth), staged.token)
    return false
  }
}

/** Preserve native password policy; commit credential/profile changes together. */
async function updateNativeUser(
  auth: BetterAuthInstance,
  context: {
    headers: Record<string, string | undefined>
    body: unknown
    query: Record<string, string | undefined>
    set: { status?: number | string }
  },
) {
  const { headers, body, query, set } = context
  const token = headers.authorization?.startsWith('Bearer ')
    ? headers.authorization.slice(7).trim()
    : ''
  if (!token) {
    set.status = 401
    return { message: 'Invalid authorization header' }
  }
  try {
    const update = parseNativeUpdate(body)
    const { row, staged } = await authDb(auth)
      .transaction()
      .execute((transaction) => applyNativeUpdate(auth, transaction, token, update))
    if (staged?.deliver && !(await deliverAddressChange(auth, staged, query.redirect_to))) {
      console.error(`[AUTH] Email change delivery failed: user=${row.id}`)
      // GoTrue's message when the email-change mail cannot be sent.
      return goTrueError(set, 500, 'unexpected_failure', 'Error sending email change email')
    }
    const user = bridgeGetUserResponse({ user: row, session: {} })
    // GoTrue reports the pending address until the link is verified.
    return staged
      ? { ...user, new_email: staged.to, email_change_sent_at: staged.sentAt.toISOString() }
      : user
  } catch (error) {
    if (error instanceof UserUpdateRefused)
      return goTrueError(set, error.status, error.errorCode, error.message, error.extra)
    set.status = 500
    return { message: 'User update failed' }
  }
}

/** GoTrue SMTP_MAX_FREQUENCY default: one recovery email per user per 60 seconds. */
const RECOVERY_INTERVAL_MS = 60_000
/** Verification row marking a user's live recovery interval (GoTrue recovery_sent_at). */
const RECOVERY_SENT_PREFIX = 'recovery-sent:'
const recoverBody = z.object({ email: z.string().trim().email() })

/** redirect_to is honoured only for Better Auth trusted origins (SINOPEBASE_EXTRA_ORIGINS). */
async function trustedRedirect(auth: BetterAuthInstance, redirectTo: string | undefined) {
  if (!redirectTo || !URL.canParse(redirectTo)) return undefined
  return (await nativeContext(auth)).isTrustedOrigin(redirectTo) ? redirectTo : undefined
}

/**
 * Claim the user's recovery interval. The advisory lock serialises concurrent
 * claims and is released before any mail is sent. Returns the user's existing
 * recovery tokens, or null while an earlier claim is live.
 */
function claimRecoveryInterval(auth: BetterAuthInstance, userId: string) {
  const identifier = RECOVERY_SENT_PREFIX + userId
  return authDb(auth)
    .transaction()
    .execute(async (transaction) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${identifier}, 0))`.execute(
        transaction,
      )
      const live = await transaction
        .selectFrom('verification')
        .select('id')
        .where('identifier', '=', identifier)
        .where('expiresAt', '>', new Date())
        .executeTakeFirst()
      if (live) return null
      await transaction.deleteFrom('verification').where('identifier', '=', identifier).execute()
      const now = new Date()
      await transaction
        .insertInto('verification')
        .values({
          id: crypto.randomUUID(),
          identifier,
          value: userId,
          expiresAt: new Date(now.getTime() + RECOVERY_INTERVAL_MS),
          createdAt: now,
          updatedAt: now,
        })
        .execute()
      const existing = await transaction
        .selectFrom('verification')
        .select('identifier')
        .where('identifier', 'like', `${RESET_PREFIX}%`)
        .where('value', '=', userId)
        .execute()
      return existing.map(({ identifier: token }) => token)
    })
}

/**
 * After the send: the new link replaces older ones (GoTrue keeps one recovery
 * token per user). If no new link survived, delivery failed and dropped it, so
 * reopen the interval and leave the earlier links valid.
 */
async function settleRecoveryInterval(
  auth: BetterAuthInstance,
  userId: string,
  previous: string[],
) {
  await authDb(auth)
    .transaction()
    .execute(async (transaction) => {
      const issued = await transaction
        .selectFrom('verification')
        .select('identifier')
        .where('identifier', 'like', `${RESET_PREFIX}%`)
        .where('value', '=', userId)
        .where('identifier', 'not in', ['', ...previous])
        .orderBy('createdAt', 'desc')
        .executeTakeFirst()
      if (issued) {
        await retireRecoveryLinks(transaction, userId, issued.identifier)
        return
      }
      console.error(`[AUTH] Recovery email delivery failed: user=${userId}`)
      await transaction
        .deleteFrom('verification')
        .where('identifier', '=', RECOVERY_SENT_PREFIX + userId)
        .execute()
    })
}

/** Issue a Better Auth reset token and mail its GoTrue link, once per interval per user. */
async function sendRecovery(
  auth: BetterAuthInstance,
  userId: string,
  email: string,
  redirectTo: string | undefined,
) {
  const requestPasswordReset = auth.api.requestPasswordReset
  if (!requestPasswordReset) throw new Error('Native password recovery unavailable')
  const previous = await claimRecoveryInterval(auth, userId)
  if (!previous) return
  await requestPasswordReset({ body: { email, redirectTo } })
  await settleRecoveryInterval(auth, userId, previous)
}

/** POST /auth/v1/recover — always `{}` for a valid address, so accounts cannot be enumerated. */
async function recoverPassword(
  auth: BetterAuthInstance,
  context: {
    body: unknown
    query: Record<string, string | undefined>
    set: { status?: number | string }
  },
) {
  const parsed = recoverBody.safeParse(context.body)
  if (!parsed.success)
    return goTrueError(
      context.set,
      400,
      'validation_failed',
      'Unable to validate email address: invalid format',
    )
  const email = parsed.data.email.toLowerCase()
  const redirectTo = await trustedRedirect(auth, context.query.redirect_to)
  const user = await authDb(auth)
    .selectFrom('user')
    .select('id')
    .where(sql<string>`lower(email)`, '=', email)
    .where('deletedAt', 'is', null)
    .executeTakeFirst()
  if (user) await sendRecovery(auth, user.id, email, redirectTo)
  return {}
}

/** GoTrue verification type of an email-change link. */
const EMAIL_CHANGE = 'email_change'
const verifyBody = z.object({
  type: z.enum([RECOVERY, EMAIL_CHANGE]),
  token_hash: z.string().min(1),
})

/**
 * Confirm the address on recovery, as GoTrue does: the link proved control of
 * the mailbox it was sent to. Refused unless the account still has that address.
 * An address confirmed for the first time drops every provider identity and
 * session the account had (sinope#1097): a provider that asserted an address
 * it never proved (e.g. Microsoft) must not keep the mailbox owner's account.
 */
function confirmRecoveredUser(auth: BetterAuthInstance, userId: string, token: string) {
  return authDb(auth)
    .transaction()
    .execute(async (transaction) => {
      const sentTo = await transaction
        .deleteFrom('verification')
        .where('identifier', '=', RECOVERY_EMAIL_PREFIX + token)
        .where('expiresAt', '>', new Date())
        .returning('value')
        .executeTakeFirst()
      if (!sentTo) return undefined
      const unproven = await transaction
        .selectFrom('user')
        .select('id')
        .where('id', '=', userId)
        .where('emailVerified', '=', false)
        .where(sql<string>`lower(email)`, '=', sentTo.value)
        .forUpdate()
        .executeTakeFirst()
      if (unproven) {
        await transaction
          .deleteFrom('account')
          .where('userId', '=', userId)
          .where('providerId', '<>', 'credential')
          .execute()
        await transaction.deleteFrom('refresh_tokens').where('user_id', '=', userId).execute()
        await transaction.deleteFrom('session').where('userId', '=', userId).execute()
      }
      return transaction
        .updateTable('user')
        .set({ emailVerified: true })
        .where('id', '=', userId)
        .where(sql<string>`lower(email)`, '=', sentTo.value)
        .returningAll()
        .executeTakeFirst()
    })
}

/**
 * Apply an email change: the link proved control of the new address, so it is
 * confirmed with it. Links die once the account address differs from the one
 * the change was requested from. Recovery links mailed to the old address and
 * other pending changes die with it, as in GoTrue.
 */
function applyEmailChange(auth: BetterAuthInstance, token: string) {
  return authDb(auth)
    .transaction()
    .execute(async (transaction) => {
      const pending = await pendingEmailChange(transaction, token)
      if (!pending) return undefined
      // The user lock comes first, as for PUT /auth/v1/user, which also writes these rows.
      const user = await transaction
        .selectFrom('user')
        .select('email')
        .where('id', '=', pending.userId)
        .forUpdate()
        .executeTakeFirst()
      const used = await consumeEmailChange(transaction, token)
      if (!used || user?.email.toLowerCase() !== pending.from) return undefined
      if (await addressTaken(transaction, pending.to, pending.userId))
        throw new UserUpdateRefused(
          422,
          'email_exists',
          'A user with this email address has already been registered',
        )
      await retireRecoveryLinks(transaction, pending.userId)
      await retireEmailChanges(transaction, pending.userId)
      return transaction
        .updateTable('user')
        .set({ email: pending.to, emailVerified: true, updatedAt: new Date() })
        .where('id', '=', pending.userId)
        .returningAll()
        .executeTakeFirstOrThrow()
    })
}

/** type=email_change: apply the staged change, then open an ordinary session. */
async function verifyEmailChange(
  auth: BetterAuthInstance,
  tokenHash: string,
  set: { status?: number | string },
) {
  const changed = await applyEmailChange(auth, tokenHash).catch((error: unknown) => {
    if (error instanceof UserUpdateRefused) return error
    throw error
  })
  if (changed instanceof UserUpdateRefused)
    return goTrueError(set, changed.status, changed.errorCode, changed.message)
  if (!changed) return goTrueError(set, 403, 'otp_expired', 'Email link is invalid or has expired')
  const native = await nativeContext(auth)
  const session = await native.internalAdapter.createSession(changed.id, false)
  return issueSession(auth, { token: session.token, user: changed })
}

/**
 * POST /auth/v1/verify (token_hash) — use up the token. type=recovery opens a
 * recovery session; type=email_change applies the change and opens a session.
 */
async function verifyEmailLink(
  auth: BetterAuthInstance,
  context: { body: unknown; set: { status?: number | string } },
) {
  const parsed = verifyBody.safeParse(context.body)
  if (!parsed.success)
    return goTrueError(
      context.set,
      400,
      'validation_failed',
      'Only type recovery or email_change with a token_hash can be verified',
    )
  if (parsed.data.type === EMAIL_CHANGE)
    return verifyEmailChange(auth, parsed.data.token_hash, context.set)
  const native = await nativeContext(auth)
  const verification = await native.internalAdapter.consumeVerificationValue(
    RESET_PREFIX + parsed.data.token_hash,
  )
  const user = verification
    ? await confirmRecoveredUser(auth, verification.value, parsed.data.token_hash)
    : undefined
  if (!user)
    return goTrueError(context.set, 403, 'otp_expired', 'Email link is invalid or has expired')
  const session = await native.internalAdapter.createSession(user.id, false, {
    authMethod: RECOVERY,
  })
  return issueSession(auth, { token: session.token, user })
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
  try {
    const { email, password } = body as { email: string; password: string }
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

const TOKEN_GRANTS = new Map<
  string,
  (auth: BetterAuthInstance, context: GrantContext) => Promise<unknown>
>([
  ['password', passwordGrant],
  ['refresh_token', refreshTokenGrant],
  ['authorization_code', authorizationCodeGrant],
  ['pkce', (auth, { body }) => pkceGrant(oauthFlowAuth(auth), body)],
])

/** GoTrue unlinkIdentity, refusing the user's last sign-in method (sinope#1097). */
async function unlinkIdentity(
  auth: BetterAuthInstance,
  context: {
    headers: Record<string, string | undefined>
    params: { id: string }
    set: { status?: number | string }
  },
) {
  const { headers, params, set } = context
  const token = headers.authorization?.startsWith('Bearer ')
    ? headers.authorization.slice(7).trim()
    : ''
  if (!token) return goTrueError(set, 401, 'no_authorization', 'Invalid authorization header')
  try {
    return await authDb(auth)
      .transaction()
      .execute(async (transaction) => {
        // The user lock serialises concurrent unlinks, so two cannot both see a spare method.
        const { user } = await lockUpdatingSession(transaction, token)
        const methods = (await signInAccounts(transaction, user.id)).map((account) => ({
          id: account.id,
          provider: account.providerId,
        }))
        const removal = removeSignInMethod(methods, params.id)
        if (!removal.allowed)
          throw removal.reason === 'not_found'
            ? new UserUpdateRefused(404, 'identity_not_found', 'Identity does not exist')
            : new UserUpdateRefused(
                422,
                'single_identity_not_deletable',
                'User must have at least 1 identity after unlinking',
              )
        await transaction
          .deleteFrom('account')
          .where('id', '=', removal.method.id)
          .where('userId', '=', user.id)
          .execute()
        return {}
      })
  } catch (error) {
    if (error instanceof UserUpdateRefused)
      return goTrueError(set, error.status, error.errorCode, error.message)
    throw error
  }
}

/**
 * Tombstone the session's own user (see tombstoneUser), in the caller's
 * transaction. Like Better Auth's deleteUser, it needs a recent sign-in.
 */
async function deleteSessionUser(transaction: Transaction<BetterAuthDatabase>, token: string) {
  const { user, session } = await lockUpdatingSession(transaction, token)
  if (Date.now() - session.createdAt.getTime() > REAUTHENTICATION_WINDOW_MS)
    throw new UserUpdateRefused(
      400,
      'reauthentication_needed',
      'Sign in again to delete this account.',
    )
  await tombstoneUser(transaction, user.id).catch((error: unknown) => {
    // A deployment record still needs the user: its trigger raised restrict_violation.
    if (error instanceof Error && 'code' in error && error.code === '23001')
      throw new UserUpdateRefused(
        409,
        'user_deletion_restricted',
        'This account cannot be deleted yet.',
      )
    throw error
  })
  return user.id
}

/**
 * Self-service account deletion (sinope#1189). GoTrue has no self-delete, so
 * this follows its soft delete: the session's own user becomes a tombstone and
 * every session, credential and agent grant ends.
 */
async function deleteNativeUser(
  auth: BetterAuthInstance,
  context: { headers: Record<string, string | undefined>; set: { status?: number | string } },
) {
  const { headers, set } = context
  const token = headers.authorization?.startsWith('Bearer ')
    ? headers.authorization.slice(7).trim()
    : ''
  if (!token) return goTrueError(set, 401, 'no_authorization', 'Invalid authorization header')
  try {
    const userId = await authDb(auth)
      .transaction()
      .execute((transaction) => deleteSessionUser(transaction, token))
    console.info(`[AUTH] Account deleted: user=${userId}`)
    return {}
  } catch (error) {
    if (error instanceof UserUpdateRefused)
      return goTrueError(set, error.status, error.errorCode, error.message)
    throw error
  }
}

export function createAuthPlugin(
  auth: BetterAuthInstance,
  oauthProviderIds?: string[],
  serviceKey?: string,
  deliverMail?: DeliverMail,
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
      .use(createAdminUsersPlugin(authDb(auth), serviceKey, deliverMail))
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
      .put('/auth/v1/user', (context) => updateNativeUser(auth, context))
      .patch('/auth/v1/user', (context) => updateNativeUser(auth, context))
      .post('/auth/v1/recover', (context) => recoverPassword(auth, context))
      .post('/auth/v1/verify', (context) => verifyEmailLink(auth, context))
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
          // GoTrue user.identities: the sign-in methods the Account page lists and unlinks.
          const identities = toIdentities(await signInAccounts(authDb(auth), row.id), row)
          return { ...bridgeGetUserResponse({ user: row, session: {} }), identities }
        } catch {
          set.status = 401
          return { message: 'Invalid authorization header' }
        }
      })
      .delete('/auth/v1/user/identities/:id', (context) => unlinkIdentity(auth, context))
      .delete('/auth/v1/user', (context) => deleteNativeUser(auth, context))
      .get('/auth/v1/authorize', ({ query }) => authorize(oauthFlowAuth(auth), query))
      .get('/auth/v1/user/identities/authorize', ({ request, query }) =>
        authorizeLink(oauthFlowAuth(auth), request, query),
      )
      .get('/auth/v1/user/identities/link', ({ query }) => startLink(oauthFlowAuth(auth), query))
      .get('/auth/v1/oauth/complete', ({ request, query }) =>
        completeFlow(oauthFlowAuth(auth), request, query),
      )
  )
}
