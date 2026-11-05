import type { PostgresRequestContext } from '~/core/db-postgres'

/**
 * Routes that enforce their own storage authorization: public downloads, and signed GETs and
 * uploads, whose HMAC token is the credential. A client holding only a signed upload URL (an
 * External Agent, sinope#1103, or supabase-js `uploadToSignedUrl()`) can PUT without a key.
 */
const KEYLESS_ROUTES: ReadonlyArray<{ method?: string; path: RegExp }> = [
  { path: /^\/storage\/v1\/object\/public\// },
  { method: 'GET', path: /^\/storage\/v1\/object\/signed\/[^/]+$/ },
  { method: 'PUT', path: /^\/storage\/v1\/object\/signed\/upload\/[^/]+$/ },
  { method: 'PUT', path: /^\/storage\/v1\/object\/upload\/sign\/[^/]+\/./ },
]

export function requiresApiAuthorization(request: Request): boolean {
  const path = new URL(request.url).pathname
  if (!/^\/(?:rest|storage)\/v1\//.test(path) || request.method === 'OPTIONS') return false
  return !KEYLESS_ROUTES.some(
    (route) => (route.method ?? request.method) === request.method && route.path.test(path),
  )
}

function allowsAnonymousKey(request: Request): boolean {
  const path = new URL(request.url).pathname
  return (
    path.startsWith('/storage/v1/') ||
    (request.method === 'POST' && path.startsWith('/rest/v1/rpc/')) ||
    ['GET', 'HEAD'].includes(request.method)
  )
}

function bearerToken(request: Request): string {
  const header = request.headers.get('authorization') ?? ''
  return header.startsWith('Bearer ') ? header.slice(7) : header
}

/** Share validated key/session resolution with realtime, retaining REST write restrictions. */
export async function authorizeApiRequest(
  request: Request,
  resolve: (token: string) => Promise<PostgresRequestContext | undefined>,
): Promise<PostgresRequestContext> {
  const token = bearerToken(request)
  const context = await resolve(token)
  if (!context) throw new Error(token ? 'Invalid authorization token' : 'Authorization required')
  if (context.role === 'anon' && !allowsAnonymousKey(request)) {
    throw new Error('Invalid authorization token')
  }
  return context
}
