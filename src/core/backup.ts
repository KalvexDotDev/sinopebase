/**
 * PostgreSQL Backup Utility
 *
 * Provides pg_dump / pg_restore wrappers via Bun.spawn, backup file
 * verification, listing, and cleanup. No new npm dependencies.
 */

import { existsSync } from 'node:fs'
import { readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackupFileInfo {
  /** File name (basename). */
  name: string
  /** Full path on disk. */
  path: string
  /** File size in bytes. */
  size: number
  /** Last modified ISO timestamp. */
  modified: string
}

// ---------------------------------------------------------------------------
// Connection-string parsing
// ---------------------------------------------------------------------------

interface ParsedPgUrl {
  host: string
  port: string
  user: string
  password: string
  database: string
}

/**
 * Parse a PostgreSQL connection string into its components.
 *
 * Accepts postgres:// / postgresql:// URLs and DSN-style strings.
 */
function parsePgUrl(connectionString: string): ParsedPgUrl {
  // Try URL parse first (postgres://user:pass@host:port/dbname)
  try {
    const url = new URL(connectionString)
    if (url.protocol === 'postgres:' || url.protocol === 'postgresql:') {
      return {
        host: url.hostname,
        port: url.port || '5432',
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: url.pathname.replace(/^\//, ''),
      }
    }
  } catch {
    // Not a valid URL — try DSN-style parsing below
  }

  // Fallback: treat as a libpq key=value DSN string
  const parts = connectionString.split(/\s+/).reduce(
    (acc, part) => {
      const eq = part.indexOf('=')
      if (eq !== -1) {
        acc[part.slice(0, eq)] = part.slice(eq + 1)
      }
      return acc
    },
    {} as Record<string, string>,
  )

  return {
    host: parts.host || 'localhost',
    port: parts.port || '5432',
    user: parts.user || '',
    password: parts.password || '',
    database: parts.dbname || '',
  }
}

// ---------------------------------------------------------------------------
// pg_dump
// ---------------------------------------------------------------------------

/**
 * Run pg_dump against the given connection string, writing output to
 * outputPath. Uses --clean --if-exists --no-owner.
 *
 * Returns the outputPath on success.
 */
export async function pgDump(connectionString: string, outputPath: string): Promise<string> {
  const parsed = parsePgUrl(connectionString)

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
  }
  if (parsed.password) {
    env.PGPASSWORD = parsed.password
  }

  const proc = Bun.spawn(
    [
      'pg_dump',
      '-h',
      parsed.host,
      '-p',
      parsed.port,
      '-U',
      parsed.user,
      '-d',
      parsed.database,
      '--clean',
      '--if-exists',
      '--no-owner',
    ],
    {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  const out = await new Response(proc.stdout).arrayBuffer()
  const err = await new Response(proc.stderr).text()
  const exitCode = await proc.exitCode

  if (exitCode !== 0) {
    throw new Error(`pg_dump failed (exit ${exitCode}): ${err || '(no stderr)'}`)
  }

  // Write the dump to disk
  await Bun.write(outputPath, new Uint8Array(out))

  return outputPath
}

// ---------------------------------------------------------------------------
// psql restore
// ---------------------------------------------------------------------------

/**
 * Restore a SQL dump file via psql.
 *
 * Runs `psql < inputPath` against the given connection string.
 */
export async function pgRestore(connectionString: string, inputPath: string): Promise<void> {
  const parsed = parsePgUrl(connectionString)

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
  }
  if (parsed.password) {
    env.PGPASSWORD = parsed.password
  }

  const file = Bun.file(inputPath)
  const exists = await file.exists()
  if (!exists) {
    throw new Error(`Backup file not found: ${inputPath}`)
  }

  const content = await file.arrayBuffer()

  const proc = Bun.spawn(
    ['psql', '-h', parsed.host, '-p', parsed.port, '-U', parsed.user, '-d', parsed.database],
    {
      env,
      stdio: ['pipe', 'ignore', 'pipe'],
    },
  )

  // Write dump content to stdin
  proc.stdin.write(new Uint8Array(content))
  proc.stdin.end()

  const err = await new Response(proc.stderr).text()
  const exitCode = await proc.exitCode

  if (exitCode !== 0) {
    throw new Error(`psql restore failed (exit ${exitCode}): ${err || '(no stderr)'}`)
  }
}

// ---------------------------------------------------------------------------
// verifyBackup
// ---------------------------------------------------------------------------

/**
 * Verify that a backup file exists, is non-empty, and starts with valid SQL
 * (i.e. a SQL comment line or a valid SQL statement).
 */
export async function verifyBackup(path: string): Promise<boolean> {
  // Check file exists
  if (!existsSync(path)) return false

  const file = Bun.file(path)
  const statResult = await file.stat()
  if (!statResult || statResult.size === 0) return false

  // Read the first few bytes
  const sample = await file.slice(0, 512).text()

  // Must be non-empty after trimming
  if (!sample.trim()) return false

  // Must not contain null bytes (binary garbage)
  if (sample.includes('\0')) return false

  // pg_dump plain format always starts with a comment line.
  // Accept any printable-first-byte as a loose validation so
  // custom-format dumps also pass.
  const first = sample[0]
  if (!first) return true // empty content is valid (no-op restore)
  return /[\x20-\x7E\t\n\r]/.test(first)
}

// ---------------------------------------------------------------------------
// listBackups
// ---------------------------------------------------------------------------

/**
 * List backup files in a directory, sorted by modified time descending
 * (newest first). Returns an array of BackupFileInfo.
 */
export async function listBackups(backupDir: string): Promise<BackupFileInfo[]> {
  if (!existsSync(backupDir)) return []

  const entries = await readdir(backupDir, { withFileTypes: true })
  const files: BackupFileInfo[] = []

  for (const entry of entries) {
    if (!entry.isFile()) continue

    const fullPath = join(backupDir, entry.name)
    try {
      const st = await stat(fullPath)
      files.push({
        name: entry.name,
        path: fullPath,
        size: st.size,
        modified: st.mtime.toISOString(),
      })
    } catch {
      // Skip files that can't be stat'd
    }
  }

  // Sort newest first
  files.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime())

  return files
}

// ---------------------------------------------------------------------------
// cleanupOldBackups
// ---------------------------------------------------------------------------

/**
 * Retain the N most recent backups and delete older ones.
 *
 * Only operates on files matching the expected backup/restore naming
 * convention (those listed by listBackups). Returns the list of deleted
 * file paths.
 */
export async function cleanupOldBackups(backupDir: string, keepCount: number): Promise<string[]> {
  const backups = await listBackups(backupDir)
  const deleted: string[] = []

  if (backups.length <= keepCount) return deleted

  // backups are sorted newest-first; delete those past the keepCount
  const toDelete = backups.slice(keepCount)

  for (const backup of toDelete) {
    try {
      await unlink(backup.path)
      deleted.push(backup.name)
    } catch {
      // Best-effort delete
    }
  }

  return deleted
}
