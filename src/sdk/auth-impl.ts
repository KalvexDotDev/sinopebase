/**
 * Auth Client Implementation
 *
 * Real HTTP calls to Sinopebase /auth/v1 endpoints.
 * Backend returns 404/501 until Phase 2 (Auth) is ported.
 */

import type { AuthClient, AuthResponse, User, Session, AuthError, AuthChangeEvent } from './auth'

export function createAuthClient(baseUrl: string, apiKey: string): AuthClient {
  const headers = {
    'Content-Type': 'application/json',
    'apikey': apiKey,
    'Authorization': `Bearer ${apiKey}`,
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) {
      return {
        data: { user: null, session: null },
        error: { message: json?.message ?? res.statusText, status: res.status },
      } as T
    }
    return json as T
  }

  let currentSession: Session | null = null

  return {
    async signUp(credentials): Promise<AuthResponse> {
      const res = await request<AuthResponse>('POST', '/auth/v1/signup', credentials)
      if (!res.error && res.data.session) currentSession = res.data.session
      return res
    },

    async signInWithPassword(credentials): Promise<AuthResponse> {
      const res = await request<AuthResponse>('POST', '/auth/v1/token?grant_type=password', credentials)
      if (!res.error && res.data.session) currentSession = res.data.session
      return res
    },

    async signOut(_options?): Promise<{ error: AuthError | null }> {
      const res = await request<{ error: AuthError | null }>('POST', '/auth/v1/logout')
      if (!res.error) currentSession = null
      return res
    },

    async getUser(): Promise<{ data: { user: User | null }; error: AuthError | null }> {
      const token = currentSession?.access_token
      const authHeaders = token
        ? { ...headers, Authorization: `Bearer ${token}` }
        : headers
      const res = await fetch(`${baseUrl}/auth/v1/user`, { headers: authHeaders })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        return { data: { user: null }, error: { message: json?.message ?? res.statusText, status: res.status } }
      }
      return json as { data: { user: User | null }; error: AuthError | null }
    },

    async refreshSession(): Promise<AuthResponse> {
      const res = await request<AuthResponse>('POST', '/auth/v1/token?grant_type=refresh_token', {
        refresh_token: currentSession?.refresh_token,
      })
      if (!res.error && res.data.session) currentSession = res.data.session
      return res
    },

    onAuthStateChange(
      _callback: (event: AuthChangeEvent, session: Session | null) => void,
    ): { data: { subscription: { unsubscribe: () => void } } } {
      // TODO(port): Implement state change listener when realtime is ready
      return { data: { subscription: { unsubscribe: () => {} } } }
    },
  }
}
