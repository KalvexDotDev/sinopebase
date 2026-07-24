// ---------------------------------------------------------------------------
// Admin UI — Hash-based SPA router
// ---------------------------------------------------------------------------

declare var window: {
  location: { hash: string }
  addEventListener: (type: string, handler: () => void) => void
  removeEventListener: (type: string, handler: () => void) => void
}

export type Route = {
  path: string
  label: string
  icon?: string
}

export const ROUTES: Route[] = [
  { path: '#/', label: 'Dashboard', icon: '📊' },
  { path: '#/collections', label: 'Database', icon: '🗄️' },
  { path: '#/functions', label: 'Edge Functions', icon: '⚡' },
  { path: '#/ai', label: 'AI', icon: '🤖' },
  { path: '#/settings', label: 'Settings', icon: '⚙️' },
  { path: '#/logs', label: 'Logs', icon: '📋' },
]

export function getCurrentRoute(): string {
  return window.location.hash || '#/'
}

export function navigate(hash: string): void {
  window.location.hash = hash
}

export function onRouteChange(callback: (route: string) => void): () => void {
  const handler = () => callback(getCurrentRoute())
  window.addEventListener('hashchange', handler)
  return () => window.removeEventListener('hashchange', handler)
}
