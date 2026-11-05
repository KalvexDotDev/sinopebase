import type { PostgresRequestContext } from '~/core/db-postgres'

/**
 * Public downloads, signed GETs and signed uploads enforce their own storage authorization:
 * the HMAC token is the credential, so a client holding only a signed upload URL (an External
 * Agent, sinope#1103) can PUT without a key.
 */
export function requiresApiAuthorization(request: Request): boolean {
  const path = new URL(request.url).pathname
  if (!/^\/(?:rest|storage)\/v1\//.test(path)) return false
  if (request.method === 'OPTIONS') return false
  if (path.startsWith('/storage/v1/object/public/')) return false
  if (request.method === 'PUT' && /^\/storage\/v1\/object\/signed\/upload\/[^/]+$/.test(path)) {
    return false
  }
  return !(request.method === 'GET' && /^\/storage\/v1\/object\/signed\/[^/]+$/.test(path))
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
