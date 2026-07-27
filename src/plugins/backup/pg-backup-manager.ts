// ---------------------------------------------------------------------------
// PostgreSQL Backup Manager — pg_dump / pg_restore backed by RustFS
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process'
import type { BackupFileInfo, BackupManager } from '~/apis/backup'

export interface PGBackupConfig {
  /** PostgreSQL connection string */
  postgresUrl: string
  /** S3/RustFS endpoint for backup storage */
  s3Endpoint: string
  s3AccessKey: string
  s3SecretKey: string
  /** Backup bucket name (default: 'backups') */
  bucket?: string
}

export class PGBackupManager implements BackupManager {
  private config: Required<PGBackupConfig>

  constructor(config: PGBackupConfig) {
    this.config = {
      bucket: 'backups',
      ...config,
    }
  }

  async listBackups(): Promise<BackupFileInfo[]> {
    // List objects in the backup bucket via S3 API
    const url = `${this.config.s3Endpoint}/${this.config.bucket}?list-type=2`
    const res = await fetch(url, {
      headers: this.s3AuthHeaders(),
    })
    if (!res.ok) return []

    // Parse XML response from S3 ListObjectsV2
    const xml = await res.text()
    const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)]
      .map((m) => m[1])
      .filter((k): k is string => k !== undefined)

    return keys.map((key) => ({
      key,
      size: 0, // S3 list doesn't include size in basic listing
      modified: new Date().toISOString(),
    }))
  }

  async createBackup(name: string): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const key = name || `backup-${timestamp}`
    const fileName = `${key}.dump`

    // Run pg_dump
    const dump = await this.execPGDump()
    if (!dump) throw new Error('pg_dump failed')

    // Upload to S3
    const url = `${this.config.s3Endpoint}/${this.config.bucket}/${fileName}`
    const res = await fetch(url, {
      method: 'PUT',
      headers: this.s3AuthHeaders(),
      body: dump,
    })
    if (!res.ok) throw new Error(`S3 upload failed: ${res.status} ${await res.text()}`)
  }

  async deleteBackup(key: string): Promise<void> {
    const url = `${this.config.s3Endpoint}/${this.config.bucket}/${key}`
    const res = await fetch(url, {
      method: 'DELETE',
      headers: this.s3AuthHeaders(),
    })
    if (!res.ok) throw new Error(`S3 delete failed: ${res.status}`)
  }

  async restoreBackup(key: string): Promise<void> {
    // Download from S3
    const url = `${this.config.s3Endpoint}/${this.config.bucket}/${key}`
    const res = await fetch(url, { headers: this.s3AuthHeaders() })
    if (!res.ok) throw new Error(`S3 download failed: ${res.status}`)
    const dump = await res.arrayBuffer()

    // Run pg_restore
    await this.execPGRestore(Buffer.from(dump))
  }

  async downloadBackup(key: string): Promise<Blob | null> {
    const url = `${this.config.s3Endpoint}/${this.config.bucket}/${key}`
    const res = await fetch(url, { headers: this.s3AuthHeaders() })
    if (!res.ok) return null
    return res.blob()
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private s3AuthHeaders(): Record<string, string> {
    // Basic S3 auth using AWS Signature V4 would go here.
    // For RustFS with static credentials, use the access/secret key.
    return {
      Authorization:
        'Basic ' +
        Buffer.from(`${this.config.s3AccessKey}:${this.config.s3SecretKey}`).toString('base64'),
    }
  }

  private execPGDump(): Promise<string | null> {
    return new Promise((resolve) => {
      const url = new URL(this.config.postgresUrl)
      const env = {
        ...process.env,
        PGPASSWORD: url.password,
      }

      const args = [
        '-h',
        url.hostname,
        '-p',
        url.port || '5432',
        '-U',
        url.username || 'sinopebase',
        '-d',
        url.pathname.slice(1) || 'sinopebase',
        '--format=custom',
        '--no-owner',
        '--no-acl',
      ]

      const proc = spawn('pg_dump', args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
      const chunks: Buffer[] = []
      proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
      let stderr = ''
      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })

      proc.on('close', (code) => {
        if (code !== 0) {
          console.error(`pg_dump failed (${code}): ${stderr}`)
          resolve(null)
        } else {
          resolve(Buffer.concat(chunks).toString('utf-8'))
        }
      })
      proc.on('error', () => resolve(null))
    })
  }

  private execPGRestore(dump: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.config.postgresUrl)
      const env = {
        ...process.env,
        PGPASSWORD: url.password,
      }

      const args = [
        '-h',
        url.hostname,
        '-p',
        url.port || '5432',
        '-U',
        url.username || 'sinopebase',
        '-d',
        url.pathname.slice(1) || 'sinopebase',
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-acl',
      ]

      const proc = spawn('pg_restore', args, { env, stdio: ['pipe', 'pipe', 'pipe'] })
      let stderr = ''
      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })

      proc.on('close', (code) => {
        if (code !== 0) reject(new Error(`pg_restore failed (${code}): ${stderr}`))
        else resolve()
      })
      proc.on('error', reject)

      proc.stdin.write(dump)
      proc.stdin.end()
    })
  }
}
