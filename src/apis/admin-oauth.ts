/**
 * Admin OAuth Providers API — CRUD for OAuth/OIDC providers.
 *
 * Persisted to `pb_data/oauth_providers.json` with encrypted clientSecret values.
 * Changes take effect on server restart (better-auth config is startup-only).
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { Elysia } from 'elysia'
import type { OAuthProviderConfig } from '~/tools/auth-better'
import { decryptClientSecret, encryptClientSecret } from '~/tools/security/oauth-secrets'

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const PROVIDER_ID_RE = /^[a-zA-Z0-9_-]+$/
const ISSUER_HTTPS_RE = /^https:\/\//

/** Private / loopback IP ranges and hostnames to reject for issuer URLs. */
const BLOCKED_ISSUER_PATTERNS = [
  /^https?:\/\/(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/, // IPv4 private
  /^https?:\/\/\[?::1\]?/, // IPv6 loopback
  /^https?:\/\/\[?fc00:/i, // IPv6 ULA
  /^https?:\/\/localhost/i,
  /^https?:\/\/0\.0\.0\.0/,
]

function validateProviderId(id: string): string | null {
  if (!id || id.length > 128) return 'providerId must be 1-128 characters.'
  if (!PROVIDER_ID_RE.test(id)) return 'providerId must match ^[a-zA-Z0-9_-]+$.'
  return null
}

function validateIssuer(issuer: string): string | null {
  if (!issuer) return null // optional
  // Must be https
  if (!ISSUER_HTTPS_RE.test(issuer)) return 'Issuer must use HTTPS.'
  // No private/loopback IPs
  for (const pattern of BLOCKED_ISSUER_PATTERNS) {
    if (pattern.test(issuer)) return 'Issuer must not be a private or loopback address.'
  }
  try {
    new URL(issuer)
  } catch {
    return 'Issuer must be a valid URL.'
  }
  return null
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Load OAuth providers from disk, decrypting clientSecret values.
 *
 * @param dataDir   - App data directory (e.g. `./pb_data`).
 * @param jwtSecret - JWT secret used to derive the encryption key.
 */
export async function loadProviders(
  dataDir: string,
  jwtSecret: string,
): Promise<OAuthProviderConfig[]> {
  const path = resolve(dataDir, 'oauth_providers.json')
  if (!existsSync(path)) return []
  try {
    const raw = await readFile(path, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const providers = parsed.filter(
      (p: unknown) =>
        typeof p === 'object' &&
        p !== null &&
        typeof (p as Record<string, unknown>).providerId === 'string',
    ) as OAuthProviderConfig[]

    // Decrypt clientSecret on load (handles both encrypted and legacy plaintext)
    for (const p of providers) {
      if (p.clientSecret) {
        try {
          p.clientSecret = decryptClientSecret(p.clientSecret, jwtSecret)
        } catch {
          // If decryption fails (e.g. corrupted data), keep as-is
        }
      }
    }
    return providers
  } catch {
    return []
  }
}

/**
 * Save OAuth providers to disk with encrypted clientSecret values.
 *
 * Uses atomic writes: writes to a `.tmp` file then renames over the real path.
 * This prevents partial writes from corrupting the provider store.
 *
 * @param dataDir   - App data directory (e.g. `./pb_data`).
 * @param providers - The provider list to persist.
 * @param jwtSecret - JWT secret used to derive the encryption key.
 */
async function saveProviders(
  dataDir: string,
  providers: OAuthProviderConfig[],
  jwtSecret: string,
): Promise<void> {
  const path = resolve(dataDir, 'oauth_providers.json')
  const dir = dirname(path)
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
  }

  // Deep-clone and encrypt clientSecret before persisting
  const toStore = providers.map((p) => ({
    ...p,
    clientSecret: p.clientSecret ? encryptClientSecret(p.clientSecret, jwtSecret) : '',
  }))

  // Atomic write: temp file + rename
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(toStore, null, 2), 'utf-8')
  await rename(tmp, path)
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Create an Elysia plugin for OAuth provider CRUD.
 *
 * @param dataDir            - App data directory (e.g. `./pb_data`).
 * @param isSuperuser        - Auth guard (service_role only).
 * @param jwtSecret          - JWT secret for clientSecret encryption/decryption.
 * @param onProvidersChanged - Called after any CRUD to signal that a restart is needed.
 */
export function createAdminOAuthPlugin(
  dataDir: string,
  isSuperuser: (req: Request) => boolean,
  jwtSecret: string,
  onProvidersChanged?: (providers: OAuthProviderConfig[]) => void,
) {
  const app = new Elysia({ name: 'sinopebase-admin-oauth' })

  // ── GET /api/admin/oauth-providers — list providers ──
  app.get('/api/admin/oauth-providers', async ({ request, set }) => {
    if (!isSuperuser(request)) {
      set.status = 403
      return { code: 403, message: 'Only service_role can manage OAuth providers.' }
    }
    const providers = await loadProviders(dataDir, jwtSecret)
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

    // Validate providerId charset
    const pidErr = validateProviderId(input.providerId)
    if (pidErr) {
      set.status = 400
      return { code: 400, message: pidErr }
    }

    // Validate issuer if provided
    if (input.issuer) {
      const issuerErr = validateIssuer(input.issuer)
      if (issuerErr) {
        set.status = 400
        return { code: 400, message: issuerErr }
      }
    }

    const providers = await loadProviders(dataDir, jwtSecret)
    // Check for duplicate
    if (providers.some((p) => p.providerId === input.providerId)) {
      set.status = 409
      return { code: 409, message: `Provider "${input.providerId}" already exists.` }
    }

    const pid = input.providerId as string
    const cid = input.clientId as string
    const csecret = input.clientSecret as string
    const entry: OAuthProviderConfig = {
      providerId: pid,
      clientId: cid,
      clientSecret: csecret,
    }
    if (input.tenantId) entry.tenantId = input.tenantId
    if (input.issuer) entry.issuer = input.issuer

    providers.push(entry)
    await saveProviders(dataDir, providers, jwtSecret)
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

    // Validate issuer if provided
    if (input.issuer) {
      const issuerErr = validateIssuer(input.issuer)
      if (issuerErr) {
        set.status = 400
        return { code: 400, message: issuerErr }
      }
    }

    const providers = await loadProviders(dataDir, jwtSecret)
    const idx = providers.findIndex((p) => p.providerId === providerId)
    if (idx === -1) {
      set.status = 404
      return { code: 404, message: `Provider "${providerId}" not found.` }
    }

    const existing = providers[idx] as OAuthProviderConfig
    if (input.clientId) existing.clientId = input.clientId
    if (input.clientSecret) existing.clientSecret = input.clientSecret
    if (input.tenantId !== undefined) existing.tenantId = input.tenantId || undefined
    if (input.issuer !== undefined) existing.issuer = input.issuer || undefined

    providers[idx] = existing
    await saveProviders(dataDir, providers, jwtSecret)
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
    const providers = await loadProviders(dataDir, jwtSecret)
    const filtered = providers.filter((p) => p.providerId !== providerId)
    if (filtered.length === providers.length) {
      set.status = 404
      return { code: 404, message: `Provider "${providerId}" not found.` }
    }
    await saveProviders(dataDir, filtered, jwtSecret)
    onProvidersChanged?.(filtered)
    return { deleted: true, restartRequired: true }
  })

  return app
}
