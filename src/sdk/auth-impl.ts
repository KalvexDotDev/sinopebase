/**
 * Auth Client Implementation
 *
 * Real HTTP calls to Sinopebase /auth/v1 endpoints.
 * Backed by better-auth embedded in the Sinopebase backend.
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
  const stateChangeCallbacks = new Set<(event: AuthChangeEvent, session: Session | null) => void>()

  function emitAuthChange(event: AuthChangeEvent, session: Session | null): void {
    for (const cb of stateChangeCallbacks) {
      try {
        cb(event, session)
      } catch {
        /* swallow */
      }
    }
  }

  function authResponse(session: Session): AuthResponse {
    return { data: { user: session.user, session }, error: null }
  }

  return {
    // ── Sign up ──────────────────────────────────────────────────────

    async signUp(credentials): Promise<AuthResponse> {
      const res = await request<Session | AuthResponse>('POST', '/auth/v1/signup', credentials)
      if ('error' in res) return res
      currentSession = res
      emitAuthChange('SIGNED_IN', res)
      return authResponse(res)
    },

    // ── OAuth ────────────────────────────────────────────────────────

    async signInWithOAuth(
      credentials,
    ): Promise<{ data: { url: string } | null; error: AuthError | null }> {
      const { provider, options } = credentials
      const redirectTo = options?.redirectTo ?? `${baseUrl}/_/`
      const scopes = options?.scopes ?? ''
      const queryParams = options?.queryParams ?? {}

      const params = new URLSearchParams({ provider, callbackURL: redirectTo })
      if (scopes) params.set('scopes', scopes)
      for (const [k, v] of Object.entries(queryParams)) {
        params.set(k, v)
      }

      const url = `${baseUrl}/api/auth/sign-in/social?${params.toString()}`
      return { data: { url }, error: null }
    },

    // ── Sign in ──────────────────────────────────────────────────────

    async signInWithPassword(credentials): Promise<AuthResponse> {
      const res = await request<Session | AuthResponse>(
        'POST',
        '/auth/v1/token?grant_type=password',
        credentials,
      )
      if ('error' in res) return res
      currentSession = res
      emitAuthChange('SIGNED_IN', res)
      return authResponse(res)
    },

    // ── Sign out ─────────────────────────────────────────────────────

    async signOut(_options?): Promise<{ error: AuthError | null }> {
      const token = currentSession?.access_token
      const authHeaders = token ? { ...headers, Authorization: `Bearer ${token}` } : headers
      const res = await fetch(`${baseUrl}/auth/v1/logout`, {
        method: 'POST',
        headers: authHeaders,
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
        return {
          error: { message: (json?.message as string) ?? res.statusText, status: res.status },
        }
      }
      const prevSession = currentSession
      currentSession = null
      emitAuthChange('SIGNED_OUT', prevSession)
      return { error: null }
    },

    // ── User ─────────────────────────────────────────────────────────

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

    // ── Refresh ──────────────────────────────────────────────────────

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
      emitAuthChange('TOKEN_REFRESHED', res)
      return authResponse(res)
    },

    // ── Session ──────────────────────────────────────────────────────

    async getSession(): Promise<{
      data: { session: Session | null; user: User | null }
      error: AuthError | null
    }> {
      const token = currentSession?.access_token
      const authHeaders = token ? { ...headers, Authorization: `Bearer ${token}` } : headers
      const res = await fetch(`${baseUrl}/auth/v1/session`, { headers: authHeaders })
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
      if (!res.ok) {
        return {
          data: { session: null, user: null },
          error: { message: (json?.message as string) ?? res.statusText, status: res.status },
        }
      }
      const data = json?.data as { session: Session | null; user: User | null } | undefined
      if (data?.session) {
        currentSession = data.session
      }
      return {
        data: { session: data?.session ?? null, user: data?.user ?? null },
        error: null,
      }
    },

    async exchangeCodeForSession(code: string): Promise<AuthResponse> {
      const res = await request<Session | AuthResponse>(
        'POST',
        '/auth/v1/token?grant_type=authorization_code',
        { code },
      )
      if ('error' in res) return res
      currentSession = res
      emitAuthChange('SIGNED_IN', res)
      return authResponse(res)
    },

    async updateUser(attributes: {
      email?: string
      password?: string
      data?: Record<string, unknown>
    }): Promise<{ data: { user: User | null }; error: AuthError | null }> {
      const token = currentSession?.access_token
      const authHeaders = token ? { ...headers, Authorization: `Bearer ${token}` } : headers
      const res = await fetch(`${baseUrl}/auth/v1/user`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify(attributes),
      })
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
      if (!res.ok) {
        return {
          data: { user: null },
          error: { message: (json?.message as string) ?? res.statusText, status: res.status },
        }
      }
      const user = json as unknown as User
      if (currentSession) {
        currentSession = { ...currentSession, user }
      }
      return { data: { user }, error: null }
    },

    async resetPasswordForEmail(
      email: string,
      // biome-ignore lint/complexity/noBannedTypes: supabase-js API contract
    ): Promise<{ data: {} | null; error: AuthError | null }> {
      try {
        await fetch(`${baseUrl}/auth/v1/reset-password`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ email }),
        })
      } catch {
        /* swallow — endpoint always returns success to prevent enumeration */
      }
      return { data: {}, error: null }
    },

    async setSession(session: {
      access_token: string
      refresh_token: string
      user: User
    }): Promise<AuthResponse> {
      const restored: Session = {
        token_type: 'bearer',
        expires_in: 0,
        expires_at: 0,
        ...session,
      }
      currentSession = restored
      emitAuthChange('SIGNED_IN', restored)
      return authResponse(restored)
    },

    // ── Auth state listener ──────────────────────────────────────────

    onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void): {
      data: { subscription: { unsubscribe: () => void } }
    } {
      stateChangeCallbacks.add(callback)
      return {
        data: {
          subscription: {
            unsubscribe: () => {
              stateChangeCallbacks.delete(callback)
            },
          },
        },
      }
    },
  }
}
