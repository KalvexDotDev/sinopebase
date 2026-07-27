/**
 * Backup API — /api/backups
 *
 * Port of PocketBase's apis/backup.go.
 * Endpoints for managing app backups (list, create, download, delete, restore).
 * Layer 4 — imports from ~/core/*, ~/tools/*.
 */

import { Elysia } from 'elysia'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackupFileInfo {
  /** Backup file key/name. */
  key: string
  /** File size in bytes. */
  size: number
  /** Last modified timestamp. */
  modified: string
}

export interface BackupManager {
  /** List all available backups. */
  listBackups(): Promise<BackupFileInfo[]>
  /** Create a new backup. */
  createBackup(name: string): Promise<void>
  /** Delete a backup by key. */
  deleteBackup(key: string): Promise<void>
  /** Restore a backup by key. */
  restoreBackup(key: string): Promise<void>
  /** Download a backup by key. */
  downloadBackup(key: string): Promise<Blob | null>
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * Create an Elysia plugin that registers /api/backups endpoints.
 *
 * Most endpoints require superuser authentication.
 */
export function createBackupPlugin(backupManager: BackupManager, isSuperuser: () => boolean) {
  const app = new Elysia()

  // ── GET /api/backups — List backups ──
  app.get('/api/backups', async ({ set }) => {
    if (!isSuperuser()) {
      set.status = 403
      return { code: 403, message: 'Only superusers can list backups.' }
    }

    try {
      const backups = await backupManager.listBackups()
      return backups
    } catch (err) {
      set.status = 400
      return {
        code: 400,
        message: `Failed to list backups: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })

  // ── POST /api/backups — Create a backup ──
  app.post('/api/backups', async ({ body, set }) => {
    if (!isSuperuser()) {
      set.status = 403
      return { code: 403, message: 'Only superusers can create backups.' }
    }

    try {
      const data = (body ?? {}) as { name?: string }
      const name = data.name ?? `backup-${Date.now()}.zip`

      await backupManager.createBackup(name)

      set.status = 204
      return undefined
    } catch (err) {
      set.status = 400
      return {
        code: 400,
        message: `Failed to create backup: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })

  // ── DELETE /api/backups/:name — Delete a backup ──
  app.delete('/api/backups/:name', async ({ params, set }) => {
    if (!isSuperuser()) {
      set.status = 403
      return { code: 403, message: 'Only superusers can delete backups.' }
    }

    try {
      const key = params.name as string
      await backupManager.deleteBackup(key)

      set.status = 204
      return undefined
    } catch (err) {
      set.status = 400
      return {
        code: 400,
        message: `Failed to delete backup: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })

  // ── POST /api/backups/:name/restore — Restore a backup ──
  app.post('/api/backups/:name/restore', async ({ params, set }) => {
    if (!isSuperuser()) {
      set.status = 403
      return { code: 403, message: 'Only superusers can restore backups.' }
    }

    try {
      const key = params.name as string
      // Fire and forget — start the restore process
      setImmediate(async () => {
        try {
          await backupManager.restoreBackup(key)
        } catch (err) {
          console.error(`Backup restore failed for "${key}":`, err)
        }
      })

      set.status = 204
      return undefined
    } catch (err) {
      set.status = 400
      return {
        code: 400,
        message: `Failed to start backup restore: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })

  return app
}
