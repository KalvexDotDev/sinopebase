// ---------------------------------------------------------------------------
// Admin UI — Sinopebase API client
// ---------------------------------------------------------------------------

declare var window: { location: { origin: string } }
declare var localStorage: {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const BASE = window.location.origin

function getToken(): string | null {
  return localStorage.getItem('sb-access-token')
}

export function setToken(token: string): void {
  localStorage.setItem('sb-access-token', token)
}

export function clearToken(): void {
  localStorage.removeItem('sb-access-token')
}

/**
 * Backend HTTP request helper.
 * PocketBase-compatible calls use `request(path, options?)`:
 *   request('/api/collections')
 *   request('/api/records/foo', { headers: {} })
 * The `method` defaults to 'GET' when only `path` is given.
 */
async function request<T = any>(
  path: string,
  options?: { method?: string; body?: unknown; headers?: Record<string, string> },
): Promise<{ data: T; error: { message: string; status: number } | null }> {
  const method = options?.method ?? 'GET'
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options?.headers,
  }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (await res.json()) as any
  if (res.status >= 400) {
    return { data: null as T, error: { message: json.message || json.error, status: res.status } }
  }
  return { data: json as T, error: null }
}

// Auth
export async function signIn(email: string, password: string) {
  const res = await fetch(BASE + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (await res.json()) as any
  if (!res.ok) return { error: { message: json.message, status: res.status } }
  const token = json.access_token
  if (token) setToken(token)
  return { data: { user: json.user, session: json }, error: null }
}

export async function getUser() {
  return request('/auth/v1/user')
}

export async function signOut() {
  const res = await fetch(BASE + '/auth/v1/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
  })
  clearToken()
  return res.json()
}

// Collections
export async function listCollections() {
  return request('/api/collections')
}

// Records
export async function listRecords(collection: string) {
  return request(`/api/records/${collection}`)
}

// Functions
export async function listFunctions() {
  return request('/api/functions/v1')
}

// AI
export async function aiChat(messages: Array<{ role: string; content: string }>) {
  return fetch(BASE + '/api/mastra/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: JSON.stringify({ messages }),
  }).then((r) => r.json())
}

// Health
export async function health() {
  return request('/api/health')
}
