/**
 * GoTrue-compatible social sign-in and identity linking over Better Auth (sinope#1097).
 *
 * supabase-js `signInWithOAuth` (PKCE) opens GET /auth/v1/authorize in the
 * browser; `linkIdentity` asks GET /auth/v1/user/identities/authorize for a URL
 * to open. Better Auth runs the provider round trip (its callback,
 * /api/auth/callback/:provider, is the registered redirect URI) and lands on
 * GET /auth/v1/oauth/complete, which hands redirect_to a single-use `code`.
 * `exchangeCodeForSession` redeems it at POST /auth/v1/token?grant_type=pkce.
 *
 * Only the PKCE flow is supported. Every link decision is Better Auth's,
 * gated by the Identity Linking Policy (src/tools/auth-better/index.ts).
 */

import type { Kysely } from 'kysely'
import { z } from 'zod'
import { lookupSessionByToken, type SinopebaseAuth } from '~/tools/auth-better'
import type { BetterAuthDatabase } from '~/tools/auth-better/adapter'
import {
  createAuthCode,
  createFlow,
  createLinkTicket,
  type FlowRequest,
  heldLinks,
  holdLink,
  type OAuthFlow,
  randomToken,
  s256Challenge,
  settleLink,
  takeAuthCode,
  takeFlow,
  takeLinkTicket,
} from '~/tools/auth-better/oauth-flows'
import { refreshTokenForSession } from '~/tools/auth-better/refresh-tokens'
import { bridgeSignInResponse } from '~/tools/auth-better/supabase-bridge'
import { Equal } from '~/tools/security/crypto'

/** Browser binding of an in-flight flow; scoped to the GoTrue paths. */
const FLOW_COOKIE = 'sinopebase-oauth-flow'
const FLOW_COOKIE_PATH = '/auth/v1'

type NativeContext = Awaited<SinopebaseAuth['$context']>

/** The Better Auth surface this module uses. */
export interface OAuthFlowAuth {
  $context: Promise<
    Pick<
      NativeContext,
      'baseURL' | 'authCookies' | 'secret' | 'socialProviders' | 'isTrustedOrigin'
    >
  >
  api: {
    getSession(args: { headers: Headers }): Promise<{
      session: { id: string; createdAt: Date }
      user: { id: string }
    } | null>
    signInSocial(args: {
      body: SocialStart
      returnHeaders: true
    }): Promise<{ headers: Headers; response: { url?: string } }>
    linkSocialAccount(args: {
      body: SocialStart
      headers: Headers
      returnHeaders: true
    }): Promise<{ headers: Headers; response: { url?: string } }>
  }
  __db?: unknown
  __siteUrl?: string
}

interface SocialStart {
  provider: string
  callbackURL: string
  errorCallbackURL: string
  disableRedirect: true
}

function db(auth: OAuthFlowAuth): Kysely<BetterAuthDatabase> {
  return auth.__db as Kysely<BetterAuthDatabase>
}

function goTrueError(status: number, errorCode: string, msg: string) {
  return Response.json({ code: status, error_code: errorCode, msg, message: msg }, { status })
}

/** Only the PKCE flow is supported: an S256 challenge is required. */
const authorizeQuery = z.object({
  provider: z.string().min(1).max(64),
  redirect_to: z.string().optional(),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  code_challenge_method: z.string().regex(/^s256$/i),
})

const pkceBody = z.object({
  auth_code: z.string().min(1).max(256),
  code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
})

/** The flow request, or a GoTrue error for an unsupported provider or non-PKCE request. */
async function parseFlowRequest(
  auth: OAuthFlowAuth,
  query: unknown,
): Promise<Omit<FlowRequest, 'linkSessionId'> | Response> {
  const parsed = authorizeQuery.safeParse(query)
  if (!parsed.success)
    return goTrueError(
      400,
      'validation_failed',
      'PKCE flow with an S256 code challenge is required',
    )
  const { provider, redirect_to, code_challenge } = parsed.data
  const native = await auth.$context
  if (!native.socialProviders.some((p) => p.id === provider))
    return goTrueError(400, 'validation_failed', 'Unsupported provider: provider is not enabled')
  return {
    provider,
    redirectTo: flowDestination(auth, native, redirect_to),
    challenge: code_challenge,
  }
}

/** As for recovery links, an untrusted destination falls back to the site URL. */
function flowDestination(
  auth: OAuthFlowAuth,
  native: Pick<NativeContext, 'baseURL' | 'isTrustedOrigin'>,
  redirectTo: string | undefined,
) {
  if (redirectTo && URL.canParse(redirectTo) && native.isTrustedOrigin(redirectTo))
    return redirectTo
  return auth.__siteUrl || new URL(native.baseURL).origin
}

function flowCookie(value: string, maxAge: number, secure: boolean) {
  return `${FLOW_COOKIE}=${value}; Path=${FLOW_COOKIE_PATH}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
}

function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return value.join('=')
  }
  return undefined
}

function redirect(location: string, cookies: string[]) {
  const response = new Response(null, {
    status: 302,
    headers: { location, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
  })
  for (const cookie of cookies) response.headers.append('set-cookie', cookie)
  return response
}

/** Better Auth's signed session cookie for a session token (better-call's format). */
async function sessionCookie(native: Pick<NativeContext, 'authCookies' | 'secret'>, token: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(native.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = Buffer.from(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token)),
  ).toString('base64')
  return `${native.authCookies.sessionToken.name}=${encodeURIComponent(`${token}.${signature}`)}`
}

/** Bind a new flow to this browser and send it to the provider through Better Auth. */
async function startFlow(auth: OAuthFlowAuth, request: FlowRequest, linkToken?: string) {
  const native = await auth.$context
  const origin = new URL(native.baseURL).origin
  const binding = randomToken()
  const flowId = await createFlow(db(auth), request, binding)
  const complete = `${origin}/auth/v1/oauth/complete?flow=${flowId}`
  const body: SocialStart = {
    provider: request.provider,
    callbackURL: complete,
    errorCallbackURL: complete,
    disableRedirect: true,
  }
  const started = linkToken
    ? await auth.api.linkSocialAccount({
        body,
        headers: new Headers({ cookie: await sessionCookie(native, linkToken) }),
        returnHeaders: true,
      })
    : await auth.api.signInSocial({ body, returnHeaders: true })
  if (!started.response.url) return goTrueError(500, 'unexpected_failure', 'OAuth start failed')
  const secure = origin.startsWith('https:')
  return redirect(started.response.url, [
    ...started.headers.getSetCookie(),
    flowCookie(binding, 600, secure),
  ])
}

/** Expire the flow cookie and Better Auth's cookie session: Sinope holds the session now. */
function clearingCookies(native: Pick<NativeContext, 'authCookies' | 'baseURL'>) {
  const secure = native.baseURL.startsWith('https:')
  const cleared = [native.authCookies.sessionToken.name, native.authCookies.sessionData.name].map(
    (name) => `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`,
  )
  return [flowCookie('', 0, secure), ...cleared]
}

type Completion = { sessionId: string; pendingAccountId?: string } | { refused: string }

/** What the completed flow may hand out: a session (and a new link to hold), or a refusal. */
function completedSession(
  auth: OAuthFlowAuth,
  flow: OAuthFlow,
  request: Request,
): Promise<Completion> {
  return flow.linkSessionId
    ? completedLink(auth, flow, flow.linkSessionId)
    : completedSignIn(auth, flow, request)
}

/** The link is only complete once Better Auth wrote the account during this flow. */
async function completedLink(
  auth: OAuthFlowAuth,
  flow: OAuthFlow,
  linkSessionId: string,
): Promise<Completion> {
  const linked = await db(auth)
    .selectFrom('account')
    .innerJoin('session', 'session.userId', 'account.userId')
    .select(['session.id as sessionId', 'account.id as accountId', 'account.createdAt'])
    .where('session.id', '=', linkSessionId)
    .where('session.expiresAt', '>', new Date())
    .where('account.providerId', '=', flow.provider)
    .where('account.updatedAt', '>=', new Date(flow.startedAt))
    .executeTakeFirst()
  if (!linked) return { refused: 'unexpected_failure' }
  if (linked.createdAt.getTime() < flow.startedAt) return { sessionId: linked.sessionId }
  // A link ticket can be opened by any browser: hold the new link until the
  // browser that asked for it redeems the code with its verifier.
  await holdLink(db(auth), linked.accountId)
  return { sessionId: linked.sessionId, pendingAccountId: linked.accountId }
}

async function completedSignIn(
  auth: OAuthFlowAuth,
  flow: OAuthFlow,
  request: Request,
): Promise<Completion> {
  const signedIn = await auth.api.getSession({ headers: request.headers }).catch(() => null)
  // Only a session this flow created: never a cookie session left from earlier.
  if (!signedIn || signedIn.session.createdAt.getTime() < flow.startedAt)
    return { refused: 'unexpected_failure' }
  const accounts = await db(auth)
    .selectFrom('account')
    .select('id')
    .where('userId', '=', signedIn.user.id)
    .where('providerId', '=', flow.provider)
    .execute()
  if (
    !(await heldLinks(
      db(auth),
      accounts.map((account) => account.id),
    ))
  )
    return { sessionId: signedIn.session.id }
  // Never sign in through a link nobody has proven yet.
  await db(auth).deleteFrom('session').where('id', '=', signedIn.session.id).execute()
  return { refused: 'identity_link_pending' }
}

function withParams(base: string, params: Record<string, string>) {
  const url = new URL(base)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.href
}

const providerError = z.string().regex(/^[a-z0-9_]{1,64}$/i)

/** A refusal from the provider or Better Auth (by code), or what the flow completed. */
function flowCompletion(
  auth: OAuthFlowAuth,
  flow: OAuthFlow,
  request: Request,
  providerRefusal: string | undefined,
): Promise<Completion> | Completion {
  if (providerRefusal === undefined) return completedSession(auth, flow, request)
  return { refused: providerError.safeParse(providerRefusal).data ?? 'unexpected_failure' }
}

function refusedRedirect(redirectTo: string, refused: string, cookies: string[]) {
  return redirect(
    withParams(redirectTo, {
      error: 'access_denied',
      error_code: refused,
      error_description: refused.replaceAll('_', ' '),
    }),
    cookies,
  )
}

/** No live flow bound to this browser; still drop the cookie session Better Auth may have set. */
function flowNotFound(cookies: string[]) {
  const missing = goTrueError(400, 'flow_state_not_found', 'OAuth state not found or expired')
  for (const cookie of cookies) missing.headers.append('set-cookie', cookie)
  return missing
}

/** GET /auth/v1/oauth/complete: Better Auth lands here; redirect_to receives a code. */
export async function completeFlow(
  auth: OAuthFlowAuth,
  request: Request,
  query: Record<string, string>,
) {
  const cookies = clearingCookies(await auth.$context)
  const flow = await takeFlow(db(auth), query.flow ?? '', readCookie(request, FLOW_COOKIE))
  if (!flow) return flowNotFound(cookies)
  const completion = await flowCompletion(auth, flow, request, query.error || undefined)
  if ('refused' in completion) return refusedRedirect(flow.redirectTo, completion.refused, cookies)
  const code = await createAuthCode(
    db(auth),
    completion.sessionId,
    flow.challenge,
    completion.pendingAccountId,
  )
  return redirect(withParams(flow.redirectTo, { code }), cookies)
}

async function bearerSession(auth: OAuthFlowAuth, request: Request) {
  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) return null
  return db(auth)
    .selectFrom('session')
    .select(['id', 'token'])
    .where('token', '=', token)
    .where('expiresAt', '>', new Date())
    .executeTakeFirst()
}

/** POST /auth/v1/token?grant_type=pkce: redeem a single-use auth code. */
export async function pkceGrant(auth: OAuthFlowAuth, body: unknown) {
  const parsed = pkceBody.safeParse(body)
  if (!parsed.success) return goTrueError(400, 'validation_failed', 'Invalid PKCE token request')
  const code = await takeAuthCode(db(auth), parsed.data.auth_code)
  if (!code)
    return goTrueError(404, 'flow_state_not_found', 'Invalid flow state, no valid flow state found')
  const proven = Equal(s256Challenge(parsed.data.code_verifier), code.challenge)
  // Only the verifier proves a held link: commit it, or drop it.
  if (code.pendingAccountId) await settleLink(db(auth), code.pendingAccountId, proven)
  if (!proven)
    return goTrueError(
      400,
      'bad_code_verifier',
      'code challenge does not match previously saved code verifier',
    )
  return sessionGrant(auth, code.sessionId)
}

/** The GoTrue session response for a live session id. */
async function sessionGrant(auth: OAuthFlowAuth, sessionId: string) {
  const session = await db(auth)
    .selectFrom('session')
    .select('token')
    .where('id', '=', sessionId)
    .where('expiresAt', '>', new Date())
    .executeTakeFirst()
  const user = session ? await lookupSessionByToken(auth, session.token) : null
  if (!session || !user) return goTrueError(404, 'session_not_found', 'Session not found')
  return Response.json(
    bridgeSignInResponse(
      { token: session.token, user },
      await refreshTokenForSession(db(auth), session.token),
    ),
  )
}

/** GET /auth/v1/authorize: start a PKCE sign-in in this browser. */
export async function authorize(auth: OAuthFlowAuth, query: unknown) {
  const request = await parseFlowRequest(auth, query)
  return request instanceof Response ? request : startFlow(auth, request)
}

/** GET /auth/v1/user/identities/authorize: the URL a signed-in user opens to link a provider. */
export async function authorizeLink(auth: OAuthFlowAuth, request: Request, query: unknown) {
  const session = await bearerSession(auth, request)
  if (!session)
    return goTrueError(401, 'no_authorization', 'This endpoint requires a valid Bearer token')
  const flow = await parseFlowRequest(auth, query)
  if (flow instanceof Response) return flow
  // The browser cannot carry the Bearer token: it opens a single-use ticket instead.
  const ticket = await createLinkTicket(db(auth), { ...flow, linkSessionId: session.id })
  const origin = new URL((await auth.$context).baseURL).origin
  return { url: `${origin}/auth/v1/user/identities/link?ticket=${ticket}` }
}

/** GET /auth/v1/user/identities/link: the browser redeems its link ticket. */
export async function startLink(auth: OAuthFlowAuth, query: Record<string, string | undefined>) {
  const flow = query.ticket ? await takeLinkTicket(db(auth), query.ticket) : null
  const session = flow?.linkSessionId
    ? await db(auth)
        .selectFrom('session')
        .select('token')
        .where('id', '=', flow.linkSessionId)
        .where('expiresAt', '>', new Date())
        .executeTakeFirst()
    : undefined
  if (!flow || !session)
    return goTrueError(400, 'flow_state_not_found', 'Link request not found or expired')
  return startFlow(auth, flow, session.token)
}

/** One sign-in method: the password credential or a linked provider identity. */
export interface SignInAccount {
  id: string
  providerId: string
  accountId: string
  createdAt: Date
  updatedAt: Date
}

/** A user's sign-in methods: the password credential (if set) and linked provider identities. */
export function signInAccounts(
  database: Kysely<BetterAuthDatabase>,
  userId: string,
): Promise<SignInAccount[]> {
  return database
    .selectFrom('account')
    .select(['id', 'providerId', 'accountId', 'createdAt', 'updatedAt'])
    .where('userId', '=', userId)
    .where((eb) => eb.or([eb('providerId', '<>', 'credential'), eb('password', 'is not', null)]))
    .orderBy('createdAt')
    .execute()
}

/** GoTrue `user.identities`: the password credential is the `email` identity. */
export function toIdentities(accounts: SignInAccount[], user: { id: string; email: string }) {
  return accounts.map((account) => {
    const email = account.providerId === 'credential'
    const sub = email ? user.id : account.accountId
    return {
      identity_id: account.id,
      id: sub,
      user_id: user.id,
      provider: email ? 'email' : account.providerId,
      identity_data: email ? { sub, email: user.email } : { sub },
      created_at: account.createdAt.toISOString(),
      updated_at: account.updatedAt.toISOString(),
      last_sign_in_at: account.updatedAt.toISOString(),
    }
  })
}
