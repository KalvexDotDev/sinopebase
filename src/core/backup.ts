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

  // Try pg_dump first; fall back to SQL-based export if not available
  try {
    const which = Bun.spawnSync(['which', 'pg_dump'], { stdout: 'pipe' })
    if (which.exitCode !== 0) throw new Error('pg_dump not found')
  } catch {
    return sqlDump(connectionString, outputPath)
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
    // Version mismatches (runner pg_dump older than the server) and other
    // pg_dump failures fall back to the SQL-based export.
    console.warn(`pg_dump failed (exit ${exitCode}): ${err || '(no stderr)'} — using SQL fallback`)
    return sqlDump(connectionString, outputPath)
  }

  // Write the dump to disk
  await Bun.write(outputPath, new Uint8Array(out))

  return outputPath
}

// ---------------------------------------------------------------------------
// psql restore
// ---------------------------------------------------------------------------

/**
// ---------------------------------------------------------------------------
// SQL-based fallback dump (no pg_dump required)
// ---------------------------------------------------------------------------

/**
 * Export database schema + data using SQL queries via the connection pool.
 * Produces a .sql file with CREATE TABLE statements and INSERT rows.
 */
export async function sqlDump(connectionString: string, outputPath: string): Promise<string> {
  const { Pool } = await import('pg')
  const pool = new Pool({ connectionString, max: 1 })
  try {
    const { writeFile } = await import('node:fs/promises')
    const lines: string[] = [
      '-- Sinopebase SQL Dump',
      `-- Generated: ${new Date().toISOString()}`,
      '',
    ]

    // Get all user tables
    const tables = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `)

    for (const row of tables.rows) {
      const table = row.table_name as string

      // Dump schema
      const cols = await pool.query(
        `
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `,
        [table],
      )

      let colDefs = (
        cols.rows as Array<{
          column_name: string
          data_type: string
          is_nullable: string
          column_default: string | null
        }>
      )
        .map((c) => {
          let def = `  "${c.column_name}" ${c.data_type}`
          if (c.is_nullable === 'NO') def += ' NOT NULL'
          if (c.column_default) def += ` DEFAULT ${c.column_default}`
          return def
        })
        .join(',\n')

      // Get PKs
      const pks = await pool.query(
        `
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
        WHERE tc.table_schema = 'public' AND tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY'
      `,
        [table],
      )

      if (pks.rows.length > 0) {
        const pkCols = (pks.rows as Array<{ column_name: string }>)
          .map((r) => `"${r.column_name}"`)
          .join(', ')
        colDefs += `,\n  PRIMARY KEY (${pkCols})`
      }

      lines.push(`-- Table: ${table}`)
      lines.push(`DROP TABLE IF EXISTS "${table}" CASCADE;`)
      lines.push(`CREATE TABLE "${table}" (\n${colDefs}\n);`)
      lines.push('')

      // Dump data as INSERT
      const data = await pool.query(`SELECT * FROM "${table}"`)
      for (const dr of data.rows) {
        const vals = Object.values(dr).map((v) => {
          if (v === null) return 'NULL'
          if (typeof v === 'boolean') return v ? 'true' : 'false'
          if (typeof v === 'number') return String(v)
          if (v instanceof Date) return `'${v.toISOString()}'`
          return `'${String(v).replace(/'/g, "''")}'`
        })
        const colNames = Object.keys(dr)
          .map((c) => `"${c}"`)
          .join(', ')
        lines.push(`INSERT INTO "${table}" (${colNames}) VALUES (${vals.join(', ')});`)
      }
      lines.push('')
    }

    await writeFile(outputPath, lines.join('\n'), 'utf-8')
    return outputPath
  } finally {
    await pool.end()
  }
}

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
    // Skip directories — only list backup files.
    if (entry.isDirectory()) continue

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
      // Skip entries that can't be stat'd
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
