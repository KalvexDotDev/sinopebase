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
    options?: { data?: Record<string, unknown> }
  }): Promise<AuthResponse>

  signInWithPassword(credentials: { email: string; password: string }): Promise<AuthResponse>

  signOut(options?: { scope?: 'local' | 'global' | 'others' }): Promise<{ error: AuthError | null }>

  getUser(): Promise<{ data: { user: User | null }; error: AuthError | null }>

  refreshSession(): Promise<AuthResponse>

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
