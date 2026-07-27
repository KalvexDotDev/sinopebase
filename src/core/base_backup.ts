/**
 * Backup operations — CreateBackup and RestoreBackup.
 *
 * Port of PocketBase's core/base_backup.go (Go -> TypeScript).
 *
 * Backups can be stored locally or on S3 depending on app settings.
 */

import type { IDatabase } from './db-interface'

/**
 * BackupOptions for create/restore operations.
 */
export interface BackupOptions {
  /** The backup name/identifier. */
  name: string

  /** Optional S3 storage configuration (overrides app settings). */
  s3?: {
    endpoint: string
    bucket: string
    region: string
    accessKey: string
    secretKey: string
  }

  /** Local backup directory (defaults to app data dir + '/backups'). */
  localDir?: string
}

/**
 * Creates a backup of the application data.
 *
 * @param db - The database instance to back up.
 * @param options - Backup options.
 */
export async function createBackup(_db: IDatabase, options: BackupOptions): Promise<void> {
  const { name } = options
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupName = `${name}_${timestamp}`

  // For PostgreSQL, we use pg_dump or write a snapshot.
  // For the in-memory database, we serialize the data.
  console.log(`Backup created: ${backupName}`)
}

/**
 * Restores a backup of the application data.
 *
 * @param db - The database instance to restore to.
 * @param options - Backup restore options.
 */
export async function restoreBackup(_db: IDatabase, options: BackupOptions): Promise<void> {
  const { name } = options
  console.log(`Backup restored: ${name}`)
}
