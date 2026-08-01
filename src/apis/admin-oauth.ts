/**
 * Admin OAuth Providers API — CRUD for OAuth/OIDC providers.
 *
 * Persisted to `pb_data/oauth_providers.json`.
 * Changes take effect on server restart (better-auth config is startup-only).
 */

import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { Elysia } from 'elysia'
import type { OAuthProviderConfig } from '~/tools/auth-better'

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

let _providersPath = ''

function providersPath(dataDir: string): string {
  if (!_providersPath) {
    _providersPath = resolve(dataDir, 'oauth_providers.json')
  }
  return _providersPath
}

async function loadProviders(dataDir: string): Promise<OAuthProviderConfig[]> {
  const path = providersPath(dataDir)
  if (!existsSync(path)) return []
  try {
    const raw = await readFile(path, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (p: unknown) =>
        typeof p === 'object' &&
        p !== null &&
        typeof (p as Record<string, unknown>).providerId === 'string',
    ) as OAuthProviderConfig[]
  } catch {
    return []
  }
}

async function saveProviders(dataDir: string, providers: OAuthProviderConfig[]): Promise<void> {
  const path = providersPath(dataDir)
  const dir = dirname(path)
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
  }
  await writeFile(path, JSON.stringify(providers, null, 2), 'utf-8')
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Create an Elysia plugin for OAuth provider CRUD.
 *
 * @param dataDir      - App data directory (e.g. `./pb_data`)
 * @param isSuperuser  - Auth guard (service_role only)
 * @param onProvidersChanged - Called after any CRUD to signal that a restart is needed
 */
export function createAdminOAuthPlugin(
  dataDir: string,
  isSuperuser: (req: Request) => boolean,
  onProvidersChanged?: (providers: OAuthProviderConfig[]) => void,
) {
  const app = new Elysia({ name: 'sinopebase-admin-oauth' })

  // ── GET /api/admin/oauth-providers — list providers ──
  app.get('/api/admin/oauth-providers', async ({ request, set }) => {
    if (!isSuperuser(request)) {
      set.status = 403
      return { code: 403, message: 'Only service_role can manage OAuth providers.' }
    }
    const providers = await loadProviders(dataDir)
    // Redact secrets from the response (mask clientSecret)
    const safe = providers.map((p) => ({
      ...p,
      clientSecret: p.clientSecret ? '••••••••' : '',
    }))
    return { providers: safe, restartRequired: true }
  })

  // ── POST /api/admin/oauth-providers — add a provider ──
  app.post('/api/admin/oauth-providers', async ({ request, body, set }) => {
    if (!isSuperuser(request)) {
      set.status = 403
      return { code: 403, message: 'Only service_role can manage OAuth providers.' }
    }
    const input = (body ?? {}) as {
      providerId?: string
      clientId?: string
      clientSecret?: string
      tenantId?: string
      issuer?: string
    }
    if (!input.providerId || !input.clientId || !input.clientSecret) {
      set.status = 400
      return { code: 400, message: 'providerId, clientId, and clientSecret are required.' }
    }

    const providers = await loadProviders(dataDir)
    // Check for duplicate
    if (providers.some((p) => p.providerId === input.providerId)) {
      set.status = 409
      return { code: 409, message: `Provider "${input.providerId}" already exists.` }
    }

    const entry: OAuthProviderConfig = {
      providerId: input.providerId!,
      clientId: input.clientId!,
      clientSecret: input.clientSecret!,
    }
    if (input.tenantId) entry.tenantId = input.tenantId
    if (input.issuer) entry.issuer = input.issuer

    providers.push(entry)
    await saveProviders(dataDir, providers)
    onProvidersChanged?.(providers)
    set.status = 201
    return { provider: { ...entry, clientSecret: '••••••••' }, restartRequired: true }
  })

  // ── PATCH /api/admin/oauth-providers/:providerId — update a provider ──
  app.patch('/api/admin/oauth-providers/:providerId', async ({ request, params, body, set }) => {
    if (!isSuperuser(request)) {
      set.status = 403
      return { code: 403, message: 'Only service_role can manage OAuth providers.' }
    }
    let providerId: string
    try {
      providerId = decodeURIComponent(params.providerId)
    } catch {
      set.status = 400
      return { code: 400, message: 'Invalid provider ID.' }
    }
    const input = (body ?? {}) as {
      clientId?: string
      clientSecret?: string
      tenantId?: string
      issuer?: string
    }

    const providers = await loadProviders(dataDir)
    const idx = providers.findIndex((p) => p.providerId === providerId)
    if (idx === -1) {
      set.status = 404
      return { code: 404, message: `Provider "${providerId}" not found.` }
    }

    const existing = providers[idx]!
    if (input.clientId) existing.clientId = input.clientId
    if (input.clientSecret) existing.clientSecret = input.clientSecret
    if (input.tenantId !== undefined) existing.tenantId = input.tenantId || undefined
    if (input.issuer !== undefined) existing.issuer = input.issuer || undefined

    providers[idx] = existing
    await saveProviders(dataDir, providers)
    onProvidersChanged?.(providers)
    return { provider: { ...existing, clientSecret: '••••••••' }, restartRequired: true }
  })

  // ── DELETE /api/admin/oauth-providers/:providerId — remove a provider ──
  app.delete('/api/admin/oauth-providers/:providerId', async ({ request, params, set }) => {
    if (!isSuperuser(request)) {
      set.status = 403
      return { code: 403, message: 'Only service_role can manage OAuth providers.' }
    }
    const providerId = decodeURIComponent(params.providerId)
    const providers = await loadProviders(dataDir)
    const filtered = providers.filter((p) => p.providerId !== providerId)
    if (filtered.length === providers.length) {
      set.status = 404
      return { code: 404, message: `Provider "${providerId}" not found.` }
    }
    await saveProviders(dataDir, filtered)
    onProvidersChanged?.(filtered)
    return { deleted: true, restartRequired: true }
  })

  return app
}

/** Re-export for use by app.ts at startup (mergedProviders loading). */
export { loadProviders }
