/**
 * Settings API — GET/PATCH /api/settings
 *
 * Port of PocketBase's apis/settings.go.
 * Superuser-only endpoints for managing app settings.
 * Layer 4 — imports from ~/core/*, ~/tools/*, ~/forms/*.
 */

import { Elysia } from 'elysia'
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AppSettings {
  /** Application name. */
  appName?: string
  /** Application URL. */
  appUrl?: string
  /** Whether to allow new signups. */
  allowSignups?: boolean
  /** Whether to require email verification. */
  requireVerification?: boolean
  /** Whether to allow anonymous users. */
  allowAnonymous?: boolean
  /** The minimum password length. */
  minPasswordLength?: number
  /** The maximum file upload size in bytes. */
  maxFileSize?: number
  /** JWT secret for token signing. */
  jwtSecret?: string
  /** Trusted proxy configuration. */
  trustedProxy?: {
    headers: string[]
  }
  /** S3/file storage configuration. */
  storage?: {
    endpoint?: string
    bucket?: string
    region?: string
    accessKey?: string
    secretKey?: string
    forcePathStyle?: boolean
  }
  /** SMTP mailer configuration. */
  smtp?: {
    enabled: boolean
    host?: string
    port?: number
    username?: string
    password?: string
    fromAddress?: string
  }
  /** Superuser IP allowlist. */
  superuserIPs?: string[]
  /** All other settings as a flat map. */
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * Create an Elysia plugin that registers /api/settings endpoints.
 *
 * Both endpoints require superuser authentication.
 */
export function createSettingsPlugin(
  getSettings: () => AppSettings,
  updateSettings: (settings: AppSettings) => Promise<void>,
  isSuperuser: () => boolean,
) {
  const app = new Elysia()

  // ── GET /api/settings — List settings ──
  app.get('/api/settings', async ({ set }) => {
    if (!isSuperuser()) {
      set.status = 403
      return { code: 403, message: 'Only superusers can view settings.' }
    }

    const settings = getSettings()
    return settings
  })

  // ── PATCH /api/settings — Update settings ──
  app.patch('/api/settings', async ({ body, set }) => {
    if (!isSuperuser()) {
      set.status = 403
      return { code: 403, message: 'Only superusers can update settings.' }
    }

    try {
      const newSettings = (body ?? {}) as AppSettings
      await updateSettings(newSettings)
      return getSettings()
    } catch (err) {
      set.status = 400
      return {
        code: 400,
        message: `Failed to update settings: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })

  return app
}
