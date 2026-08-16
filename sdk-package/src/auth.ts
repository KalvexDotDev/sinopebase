/**
 * Auth Client (stub — implemented in Phase 2)
 *
 * Mirrors @supabase/auth-js (GoTrue client).
 * Backed by better-auth embedded in the Sinopebase backend.
 */

export interface AuthClient {
  signUp(credentials: {
    email: string
    password: string
    options?: { data?: Record<string, unknown>; emailRedirectTo?: string }
  }): Promise<AuthResponse>

  signInWithPassword(credentials: { email: string; password: string }): Promise<AuthResponse>

  signInWithOAuth(credentials: {
    provider: string
    options?: {
      redirectTo?: string
      scopes?: string
      queryParams?: Record<string, string>
    }
  }): Promise<{ data: { url: string } | null; error: AuthError | null }>

  signOut(options?: { scope?: 'local' | 'global' | 'others' }): Promise<{ error: AuthError | null }>

  getUser(): Promise<{ data: { user: User | null }; error: AuthError | null }>

  refreshSession(): Promise<AuthResponse>

  /** Get the current session (from cookie or stored token) */
  getSession(): Promise<{
    data: { session: Session | null; user: User | null }
    error: AuthError | null
  }>

  /**
   * Access token for database requests. Returns the in-memory session token
   * when signed in. With an SSR cookie provider, probes the cookie session
   * once per client instance. Null when signed out.
   */
  getAccessToken(): Promise<string | null>

  /** Exchange an OAuth authorization code for a session (code already consumed by better-auth, reads cookie) */
  exchangeCodeForSession(code: string): Promise<AuthResponse>

  /** Update user attributes (email, password, metadata) */
  updateUser(attributes: {
    email?: string
    password?: string
    data?: Record<string, unknown>
  }): Promise<{ data: { user: User | null }; error: AuthError | null }>

  /** Send a password reset email */
  // biome-ignore lint/complexity/noBannedTypes: supabase-js API contract uses {}
  resetPasswordForEmail(email: string): Promise<{ data: {} | null; error: AuthError | null }>

  /** Restore a session from tokens — verified against the backend, which supplies the user. */
  setSession(session: { access_token: string; refresh_token: string }): Promise<AuthResponse>

  onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void): {
    data: { subscription: { unsubscribe: () => void } }
  }
}

export interface User {
  id: string
  email: string
  role: string
  aud: string
  app_metadata: Record<string, unknown>
  user_metadata: Record<string, unknown>
  created_at: string
  updated_at: string
  email_confirmed_at?: string
  phone?: string
  last_sign_in_at?: string
}

export interface Session {
  access_token: string
  token_type: string
  expires_in: number
  expires_at: number
  refresh_token: string
  user: User
}

export interface AuthResponse {
  data: { user: User | null; session: Session | null }
  error: AuthError | null
}

export interface AuthError {
  message: string
  status: number
}

export type AuthChangeEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED'
