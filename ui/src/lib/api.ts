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

// ── Token management ──

function getUserToken(): string | null {
  return localStorage.getItem('sb-access-token')
}

export function setUserToken(token: string): void {
  localStorage.setItem('sb-access-token', token)
}

export function getServiceRoleKey(): string | null {
  return localStorage.getItem('sb-service-role-key')
}

export function setServiceRoleKey(key: string): void {
  localStorage.setItem('sb-service-role-key', key)
}

export function clearTokens(): void {
  localStorage.removeItem('sb-access-token')
  localStorage.removeItem('sb-service-role-key')
}

/** Returns the best available token — service_role takes precedence. */
function getAuthToken(): string | null {
  return getServiceRoleKey() || getUserToken()
}

// ── HTTP helpers ──

async function request<T = any>(
  path: string,
  options?: { method?: string; body?: unknown; headers?: Record<string, string> },
): Promise<{ data: T; error: { message: string; status: number } | null }> {
  const method = options?.method ?? 'GET'
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options?.headers,
  }
  const token = getAuthToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  })

  const json = (await res.json()) as any
  if (res.status >= 400) {
    return { data: null as T, error: { message: json.message || json.error || String(json), status: res.status } }
  }
  return { data: json as T, error: null }
}

// ── Auth ──

export async function signIn(email: string, password: string) {
  const res = await fetch(BASE + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const json = (await res.json()) as any
  if (!res.ok) return { error: { message: json.message || 'Login failed', status: res.status } }
  const token = json.access_token
  if (token) setUserToken(token)
  return { data: { user: json.user, session: json }, error: null }
}

export async function getUser() {
  return request('/auth/v1/user')
}

export async function signOut() {
  const token = getAuthToken()
  await fetch(BASE + '/auth/v1/logout', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  clearTokens()
}

// ── Health ──

export async function health() {
  return request('/api/health')
}

// ── Collections / Database ──

export async function listCollections() {
  return request('/api/collections')
}

export async function createCollection(data: Record<string, unknown>) {
  return request('/api/collections', { method: 'POST', body: data })
}

export async function deleteCollection(id: string) {
  return request(`/api/collections/${id}`, { method: 'DELETE' })
}

// ── Records ──

export async function listRecords(collection: string, query?: string) {
  return request(`/api/collections/${collection}/records${query ? '?' + query : ''}`)
}

// ── Admin Tables ──

export async function listTables() {
  return request<Array<{ schema: string; name: string; columns: Array<{ name: string; type: string; nullable: boolean; isPrimaryKey: boolean }>; hasRLS: boolean }>>('/api/admin/tables')
}

// ── Settings ──

export async function getSettings() {
  return request('/api/settings')
}

export async function updateSettings(data: Record<string, unknown>) {
  return request('/api/settings', { method: 'PATCH', body: data })
}

// ── Logs ──

export async function getLogs(params?: { page?: number; perPage?: number }) {
  const qs = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : ''
  return request(`/api/logs${qs}`)
}

export async function getLogStats() {
  return request('/api/logs/stats')
}

// ── Backups ──

export async function listBackups() {
  return request<Array<{ name: string; size: number; modified: string }>>('/api/admin/backups')
}

export async function createBackup(name: string) {
  return request('/api/admin/backup', { method: 'POST', body: { name } })
}

export async function restoreBackup(name: string) {
  return request('/api/admin/restore', { method: 'POST', body: { name } })
}

// ── Cron ──

export async function listCronJobs() {
  return request<Array<{ id: string; label?: string; schedule?: string; running?: boolean; lastRun?: string }>>('/api/crons')
}

export async function runCronJob(jobId: string) {
  return request(`/api/crons/${jobId}`, { method: 'POST' })
}

// ── Functions ──

export async function listFunctions() {
  return request('/api/functions/v1')
}

// ── AI ──

export async function aiChat(messages: Array<{ role: string; content: string }>) {
  const token = getAuthToken()
  return fetch(BASE + '/api/mastra/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ messages }),
  }).then((r) => r.json())
}

// ── Metrics ──

export async function getMetrics() {
  return request('/api/metrics')
}
