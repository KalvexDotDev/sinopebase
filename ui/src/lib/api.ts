// ---------------------------------------------------------------------------
// Admin UI — Sinopebase API client
// ---------------------------------------------------------------------------

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

async function request<T = any>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ data: T; error: { message: string; status: number } | null }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
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
  if (json.error) return { error: json.error }
  const token = json.data?.session?.access_token
  if (token) setToken(token)
  return { data: json.data, error: null }
}

export async function getUser() {
  return request('/auth/v1/user', { headers: {} })
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
  }).then(r => r.json())
}

// Health
export async function health() {
  return request('/api/health')
}
