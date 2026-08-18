/**
 * Auth Client Implementation
 *
 * Real HTTP calls to Sinopebase /auth/v1 endpoints.
 * Backed by better-auth embedded in the Sinopebase backend.
 *
 * With a CookieProvider (SSR), auth requests forward the session cookie and
 * persist set-cookie responses, and getAccessToken() probes the cookie
 * session once per client instance.
 */

import type { AuthChangeEvent, AuthClient, AuthError, AuthResponse, Session, User } from './auth'
import type { CookieProvider } from './ssr'

export function createAuthClient(
  baseUrl: string,
  apiKey: string,
  cookies?: CookieProvider,
): AuthClient {
  const headers = {
    'Content-Type': 'application/json',
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
  }

  let currentSession: Session | null = null
  let sessionProbe: Promise<{
    data: { session: Session | null; user: User | null }
    error: AuthError | null
  }> | null = null
  const stateChangeCallbacks = new Set<(event: AuthChangeEvent, session: Session | null) => void>()

  function cookieHeader(): string {
    if (!cookies) return ''
    return cookies
      .getAll()
      .map((c) => `${c.name}=${c.value}`)
      .join('; ')
  }

  function persistCookies(res: Response): void {
    if (!cookies) return
    const setCookies = res.headers.getSetCookie?.() ?? []
    for (const header of setCookies) {
      const parsed = parseSetCookie(header)
      if (parsed) cookies.setAll([parsed])
    }
  }

  async function authFetch(
    method: string,
    path: string,
    options: { body?: unknown; token?: string } = {},
  ): Promise<Response> {
    const reqHeaders: Record<string, string> = { ...headers }
    if (options.token) reqHeaders.Authorization = `Bearer ${options.token}`
    const cookie = cookieHeader()
    if (cookie) reqHeaders.Cookie = cookie
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: reqHeaders,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    })
    persistCookies(res)
    return res
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await authFetch(method, path, { body })
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok) {
      return {
        data: { user: null, session: null },
        error: { message: (json?.message as string) ?? res.statusText, status: res.status },
      } as T
    }
    return json as unknown as T
  }

  /**
   * Shared, in-flight cookie-session probe for SSR clients. Concurrent
   * callers await the same promise; a transient failure clears the latch so
   * the next call can retry.
   */
  async function probeCookieSession(): Promise<string | null> {
    if (!cookies) return null
    if (!sessionProbe) {
      sessionProbe = fetchSession().then((result) => {
        if (result.error) {
          sessionProbe = null
          return null
        }
        return result.data.session?.access_token ?? null
      })
    }
    return sessionProbe
  }

  async function fetchUser(token: string): Promise<{
    data: { user: User | null }
    error: AuthError | null
  }> {
    const res = await authFetch('GET', '/auth/v1/user', { token })
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok) {
      return {
        data: { user: null },
        error: { message: (json?.message as string) ?? res.statusText, status: res.status },
      }
    }
    return { data: { user: json as User }, error: null }
  }

  async function doRefreshSession(): Promise<AuthResponse> {
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
  }

  async function fetchSession(): Promise<{
    data: { session: Session | null; user: User | null }
    error: AuthError | null
  }> {
    const token = currentSession?.access_token
    const res = await authFetch('GET', '/auth/v1/session', { token })
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
    } else if (!token) {
      // Cookie-based flow: the server said there is no session — clear state.
      currentSession = null
    } else {
      // Bearer flow: the session route reads cookies only, so a null session
      // says nothing about the in-memory token — keep it.
    }
    return {
      data: { session: data?.session ?? null, user: data?.user ?? null },
      error: null,
    }
  }

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
      const res = await authFetch('POST', '/auth/v1/logout', { token })
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
      const token = currentSession?.access_token ?? (await probeCookieSession())
      return fetchUser(token ?? apiKey)
    },

    // ── Refresh ──────────────────────────────────────────────────────

    async refreshSession(): Promise<AuthResponse> {
      return doRefreshSession()
    },

    // ── Session ──────────────────────────────────────────────────────

    async getSession(): Promise<{
      data: { session: Session | null; user: User | null }
      error: AuthError | null
    }> {
      return fetchSession()
    },

    // ── Token exchange ───────────────────────────────────────────────

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

    // ── Profile update ───────────────────────────────────────────────

    async updateUser(attributes: {
      email?: string
      password?: string
      data?: Record<string, unknown>
    }): Promise<{ data: { user: User | null }; error: AuthError | null }> {
      const token = currentSession?.access_token
      const res = await authFetch('PATCH', '/auth/v1/user', { body: attributes, token })
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
      if (!res.ok) {
        return {
          data: { user: null },
          error: { message: (json?.message as string) ?? res.statusText, status: res.status },
        }
      }
      const user = json as User
      if (currentSession) {
        currentSession = { ...currentSession, user }
      }
      return { data: { user }, error: null }
    },

    // ── Password reset ───────────────────────────────────────────────

    async resetPasswordForEmail(
      email: string,
      // biome-ignore lint/complexity/noBannedTypes: supabase-js API contract
    ): Promise<{ data: {} | null; error: AuthError | null }> {
      try {
        await authFetch('POST', '/auth/v1/reset-password', { body: { email } })
      } catch {
        /* swallow — endpoint always returns success to prevent enumeration */
      }
      return { data: {}, error: null }
    },

    // ── Session restore (verified) ───────────────────────────────────

    async setSession(session: {
      access_token: string
      refresh_token: string
    }): Promise<AuthResponse> {
      // Restore locally first (supabase-js semantics: localStorage restore
      // works offline), then verify against the backend. An expired access
      // token falls through to a refresh; only a hard failure clears state.
      const restored: Session = {
        token_type: 'bearer',
        expires_in: 0,
        expires_at: 0,
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        user: {
          id: '',
          email: '',
          emailVerified: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      }
      currentSession = restored

      const { data, error } = await fetchUser(session.access_token)
      if (!data.user || error) {
        // Access token rejected (likely expired) — try the refresh token.
        const refreshed = await doRefreshSession()
        if (refreshed.error) {
          currentSession = null
          return refreshed
        }
        return refreshed
      }
      currentSession = { ...restored, user: data.user }
      emitAuthChange('SIGNED_IN', currentSession)
      return authResponse(currentSession)
    },

    // ── Access token for database requests ───────────────────────────

    async getAccessToken(): Promise<string | null> {
      if (currentSession?.access_token) return currentSession.access_token
      return probeCookieSession()
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

/** Parse a Set-Cookie header into the shape SvelteKit-style cookie providers expect. */
function parseSetCookie(
  header: string,
): { name: string; value: string; options?: Record<string, unknown> } | null {
  const [pair, ...attrs] = header.split(';')
  const eq = pair?.indexOf('=')
  if (eq === undefined || eq < 0 || eq === pair.length - 1) return null
  const name = pair.slice(0, eq).trim()
  const value = pair.slice(eq + 1).trim()
  if (!name) return null
  const opts: Record<string, unknown> = { path: '/' }
  for (const attr of attrs) {
    const [key, ...rest] = attr.trim().split('=')
    const k = key.toLowerCase()
    const v = rest.join('=')
    if (k === 'max-age') opts.maxAge = parseInt(v, 10)
    else if (k === 'secure') opts.secure = true
    else if (k === 'httponly') opts.httpOnly = true
    else if (k === 'samesite') opts.sameSite = v
    else if (k === 'path') opts.path = v
  }
  return { name, value, options: opts }
}
