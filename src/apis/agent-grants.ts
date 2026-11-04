/**
 * Agent grant routes (sinope#1098): the OAuth surface External Agents reach,
 * and the first-party endpoints the relying app uses to show the consent
 * screen, bind a grant to one tenant, and list or revoke grants.
 *
 * Better Auth serves the OAuth protocol under /api/auth/oauth2/*. Only the
 * protocol endpoints a client needs are reachable; consent goes through
 * POST /auth/v1/agent-grants, which binds the tenant, and nothing else can
 * create, change or list consents or clients.
 */

import { createHmac } from 'node:crypto'
import { verifyOAuthQueryParams } from '@better-auth/oauth-provider'
import { Elysia } from 'elysia'
import { type Kysely, sql } from 'kysely'
import { z } from 'zod'
import type { PostgresDatabase } from '~/core/db-postgres'
import { lookupAgentGrant, lookupSessionByToken } from '~/tools/auth-better'
import type { BetterAuthDatabase } from '~/tools/auth-better/adapter'
import {
  agentGrantTenant,
  findEnabledAgentClient,
  listAgentGrants,
  revokeAgentGrant,
} from '~/tools/auth-better/agent-grants'

export interface AgentGrantAuth {
  handler(request: Request): Promise<Response>
  $context: Promise<{
    baseURL: string
    secret: string
    authCookies: { sessionToken: { name: string } }
  }>
  __db?: unknown
  __agentGrantResource?: string
}

/**
 * The host database decides whether a User may bind a grant to a tenant, as
 * that User: `auth.agent_grant_tenant_allowed(text)`. A missing function, an
 * error or anything but true refuses.
 */
async function canBindTenant(database: PostgresDatabase, userId: string, tenantId: string) {
  return (
    database
      // The caller proved a sign-in session, so the check runs as that first-party session.
      .withRequestContext(
        { role: 'authenticated', userId, channel: 'first_party' },
        async (scoped) => {
          const { rows } = await sql<{ allowed: boolean | null }>`
        SELECT auth.agent_grant_tenant_allowed(${tenantId}) AS allowed
      `.execute(scoped.getWriter())
          return rows[0]?.allowed === true
        },
      )
      .catch(() => false)
  )
}

/** OAuth protocol endpoints a client calls itself; every other oauth2 route stays unreachable. */
const CLIENT_ENDPOINTS: Record<string, true> = {
  authorize: true,
  token: true,
  register: true,
  revoke: true,
  introspect: true,
  userinfo: true,
}

const oauthQuery = z.string().min(1).max(8192)
const decision = z.object({ oauth_query: oauthQuery })
const acceptance = decision.extend({ tenant_id: z.string().min(1).max(255) })

function bearerToken(request: Request): string | null {
  return /^Bearer (\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1] ?? null
}

/** The first-party User behind a Better Auth session token; agent tokens are not sessions. */
async function sessionUser(auth: AgentGrantAuth, request: Request) {
  const token = bearerToken(request)
  const user = await lookupSessionByToken(auth, token)
  return user && token ? { id: user.id, token } : null
}

function grantDb(auth: AgentGrantAuth) {
  return auth.__db as Kysely<BetterAuthDatabase>
}

/** The client and scopes of a signed authorization request; null when unsigned, expired or unknown. */
async function authorizationRequest(auth: AgentGrantAuth, query: string) {
  const { secret } = await auth.$context
  if (!(await verifyOAuthQueryParams(query, secret))) return null
  const params = new URLSearchParams(query)
  const client = await findEnabledAgentClient(grantDb(auth), params.get('client_id') ?? '')
  if (!client) return null
  return {
    client: {
      client_id: client.clientId,
      name: client.name,
      uri: client.uri,
      logo_uri: client.icon,
    },
    scopes: params.get('scope')?.split(' ').filter(Boolean) ?? [],
  }
}

/**
 * Answer a signed authorization request through Better Auth's consent
 * endpoint, as the User's session (its signed cookie, the Origin it trusts)
 * and, when accepting, with the tenant the grant binds. Returns the client
 * redirect, or null when Better Auth refused.
 */
async function decide(
  auth: AgentGrantAuth,
  sessionToken: string,
  oauth_query: string,
  tenantId?: string,
): Promise<string | null> {
  const { baseURL, secret, authCookies } = await auth.$context
  // better-call's signCookieValue: base64 HMAC-SHA256 of the token.
  const signature = createHmac('sha256', secret).update(sessionToken).digest('base64')
  const consent = () =>
    auth.handler(
      new Request(`${baseURL}/oauth2/consent`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          origin: new URL(baseURL).origin,
          cookie: `${authCookies.sessionToken.name}=${encodeURIComponent(`${sessionToken}.${signature}`)}`,
        },
        body: JSON.stringify({ accept: tenantId !== undefined, oauth_query }),
      }),
    )
  const upstream = await (tenantId ? agentGrantTenant.run(tenantId, consent) : consent())
  const result = (await upstream.json().catch(() => null)) as { url?: unknown } | null
  return upstream.ok && typeof result?.url === 'string' ? result.url : null
}

export function createAgentGrantsPlugin(auth: AgentGrantAuth, database: PostgresDatabase) {
  const resource = auth.__agentGrantResource
  const refuse = (set: { status?: number | string }, status: number, message: string) => {
    set.status = status
    return { message }
  }

  return (
    new Elysia({ name: 'sinopebase-agent-grants' })
      // RFC 8414 path-inserted metadata for the /api/auth issuer.
      .get('/.well-known/oauth-authorization-server/*', ({ request }) => auth.handler(request))
      .all('/api/auth/oauth2/*', ({ request, set }) => {
        const url = new URL(request.url)
        const endpoint = url.pathname.slice('/api/auth/oauth2/'.length)
        if (!Object.hasOwn(CLIENT_ENDPOINTS, endpoint)) return refuse(set, 404, 'Not found')
        // This server issues agent tokens for one resource; a client that omits
        // RFC 8707's resource parameter still gets a token that resource accepts.
        if (endpoint === 'authorize' && resource && !url.searchParams.has('resource')) {
          url.searchParams.set('resource', resource)
          return auth.handler(new Request(url, request))
        }
        return auth.handler(request)
      })
      // For the protected resource: the grant an agent token acts under, or 401.
      .get('/auth/v1/agent-grant', async ({ request, set }) => {
        const token = bearerToken(request)
        const grant = token ? await lookupAgentGrant(auth, token) : null
        if (!grant) {
          set.headers['www-authenticate'] = 'Bearer error="invalid_token"'
          return refuse(set, 401, 'Invalid agent token')
        }
        return {
          grant_id: grant.grantId,
          user_id: grant.userId,
          tenant_id: grant.tenantId,
          client_id: grant.clientId,
        }
      })
      // Consent screen data, from a signed authorization request only.
      .post('/auth/v1/agent-grants/request', async ({ request, body, set }) => {
        if (!(await sessionUser(auth, request))) return refuse(set, 401, 'Sign in first')
        const parsed = decision.safeParse(body)
        const authorization = parsed.success
          ? await authorizationRequest(auth, parsed.data.oauth_query)
          : null
        return authorization ?? refuse(set, 400, 'Invalid or expired authorization request')
      })
      // Accept, binding the grant to exactly one tenant the User belongs to.
      .post('/auth/v1/agent-grants', async ({ request, body, set }) => {
        const user = await sessionUser(auth, request)
        if (!user) return refuse(set, 401, 'Sign in first')
        const parsed = acceptance.safeParse(body)
        if (!parsed.success) return refuse(set, 400, 'Invalid consent')
        const { oauth_query, tenant_id } = parsed.data
        if (!(await canBindTenant(database, user.id, tenant_id))) {
          return refuse(set, 403, 'Not a member of that tenant')
        }
        const redirect = await decide(auth, user.token, oauth_query, tenant_id)
        return redirect ? { redirect_to: redirect } : refuse(set, 400, 'Consent was not accepted')
      })
      .post('/auth/v1/agent-grants/deny', async ({ request, body, set }) => {
        const user = await sessionUser(auth, request)
        if (!user) return refuse(set, 401, 'Sign in first')
        const parsed = decision.safeParse(body)
        if (!parsed.success) return refuse(set, 400, 'Invalid decision')
        const redirect = await decide(auth, user.token, parsed.data.oauth_query)
        return redirect
          ? { redirect_to: redirect }
          : refuse(set, 400, 'Invalid authorization request')
      })
      .get('/auth/v1/agent-grants', async ({ request, set }) => {
        const user = await sessionUser(auth, request)
        if (!user) return refuse(set, 401, 'Sign in first')
        return { grants: await listAgentGrants(grantDb(auth), user.id) }
      })
      .delete('/auth/v1/agent-grants/:id', async ({ request, params, set }) => {
        const user = await sessionUser(auth, request)
        if (!user) return refuse(set, 401, 'Sign in first')
        if (!(await revokeAgentGrant(grantDb(auth), user.id, params.id))) {
          return refuse(set, 404, 'No such grant')
        }
        set.status = 204
        return null
      })
  )
}
