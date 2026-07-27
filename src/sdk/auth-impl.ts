/**
 * Auth Client Implementation
 *
 * Real HTTP calls to Sinopebase /auth/v1 endpoints.
 * Backend returns 404/501 until Phase 2 (Auth) is ported.
 */

import type { AuthChangeEvent, AuthClient, AuthError, AuthResponse, Session, User } from './auth'

export function createAuthClient(baseUrl: string, apiKey: string): AuthClient {
  const headers = {
    'Content-Type': 'application/json',
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok) {
      return {
        data: { user: null, session: null },
        error: { message: (json?.message as string) ?? res.statusText, status: res.status },
      } as T
    }
    return json as unknown as T
  }

  let currentSession: Session | null = null

  function authResponse(session: Session): AuthResponse {
    return { data: { user: session.user, session }, error: null }
  }

  return {
    async signUp(credentials): Promise<AuthResponse> {
      const res = await request<Session | AuthResponse>('POST', '/auth/v1/signup', credentials)
      if ('error' in res) return res
      currentSession = res
      return authResponse(res)
    },

    async signInWithPassword(credentials): Promise<AuthResponse> {
      const res = await request<Session | AuthResponse>(
        'POST',
        '/auth/v1/token?grant_type=password',
        credentials,
      )
      if ('error' in res) return res
      currentSession = res
      return authResponse(res)
    },

    async signOut(_options?): Promise<{ error: AuthError | null }> {
      const res = await request<{ error?: AuthError | null }>('POST', '/auth/v1/logout')
      if (res.error) return { error: res.error }
      currentSession = null
      return { error: null }
    },

    async getUser(): Promise<{ data: { user: User | null }; error: AuthError | null }> {
      const token = currentSession?.access_token
      const authHeaders = token ? { ...headers, Authorization: `Bearer ${token}` } : headers
      const res = await fetch(`${baseUrl}/auth/v1/user`, { headers: authHeaders })
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
      if (!res.ok) {
        return {
          data: { user: null },
          error: { message: (json?.message as string) ?? res.statusText, status: res.status },
        }
      }
      return { data: { user: json as unknown as User }, error: null }
    },

    async refreshSession(): Promise<AuthResponse> {
      const res = await request<Session | AuthResponse>(
        'POST',
        '/auth/v1/token?grant_type=refresh_token',
        {
          refresh_token: currentSession?.refresh_token,
        },
      )
      if ('error' in res) return res
      currentSession = res
      return authResponse(res)
    },

    onAuthStateChange(_callback: (event: AuthChangeEvent, session: Session | null) => void): {
      data: { subscription: { unsubscribe: () => void } }
    } {
      // TODO(port): Implement state change listener when realtime is ready
      return { data: { subscription: { unsubscribe: () => {} } } }
    },
  }
}
