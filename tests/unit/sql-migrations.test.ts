/**
 * Tests for SQL migration loading (supabase/migrations/*.sql format).
 *
 * Verifies that raw .sql files are discovered, parsed, and wrapped
 * as DiscoveredMigration objects compatible with MigrationRunner.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadSqlMigrationsFromDirectory } from '../../src/core/migrations_loader'

describe('SQL migration discovery', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = mkdtempSync('sinopebase-test-sql-migrations-')
  })

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('discovers and loads .sql migration files in timestamp order', async () => {
    writeFileSync(
      join(tmpDir, '20240101000000_create_users.sql'),
      'CREATE TABLE users (id SERIAL PRIMARY KEY);',
    )
    writeFileSync(
      join(tmpDir, '20240102000000_add_email.sql'),
      'ALTER TABLE users ADD COLUMN email TEXT;',
    )
    // Non-sql file should be ignored
    writeFileSync(join(tmpDir, 'README.md'), '# Migrations')

    const migrations = await loadSqlMigrationsFromDirectory(tmpDir)

    expect(migrations.length).toBe(2)
    if (!migrations[0] || !migrations[1]) throw new Error('Expected 2 migrations')
    const m0 = migrations[0]
    const m1 = migrations[1]
    expect(m0.name).toBe('20240101000000_create_users')
    expect(m1.name).toBe('20240102000000_add_email')
    expect(typeof m0.up).toBe('function')
    expect(m0.down).toBeUndefined()
  })

  it('returns empty array for non-existent directory', async () => {
    const migrations = await loadSqlMigrationsFromDirectory('/nonexistent/path/12345')
    expect(migrations).toEqual([])
  })

  it('skips empty SQL files', async () => {
    writeFileSync(join(tmpDir, '20240103000000_empty.sql'), '   \n  ')

    const migrations = await loadSqlMigrationsFromDirectory(tmpDir)
    const empty = migrations.find((m) => m.name === '20240103000000_empty')
    expect(empty).toBeUndefined()
  })

  it('skips files not matching the timestamp_name.sql pattern', async () => {
    writeFileSync(join(tmpDir, 'some-random-file.sql'), 'SELECT 1;') // no timestamp prefix
    writeFileSync(join(tmpDir, 'not-a-migration.txt'), 'SELECT 1;') // wrong extension
    writeFileSync(join(tmpDir, '001.sql'), 'SELECT 1;') // digits but no underscore+name

    const withSuffix = await loadSqlMigrationsFromDirectory(tmpDir)
    const names = withSuffix.map((m) => m.name)

    expect(names.some((n) => n.includes('some-random-file'))).toBe(false)
    expect(names.some((n) => n.includes('not-a-migration'))).toBe(false)
    expect(names.some((n) => n.includes('001'))).toBe(false)
  })

  it('wraps SQL content in migration up function', async () => {
    writeFileSync(
      join(tmpDir, '20240104000000_create_index.sql'),
      'CREATE INDEX idx_test ON users(email);',
    )

    const migrations = await loadSqlMigrationsFromDirectory(tmpDir)
    const migration = migrations.find((m) => m.name === '20240104000000_create_index')
    expect(migration).toBeDefined()
    if (!migration) throw new Error('Expected migration')
    expect(typeof migration.up).toBe('function')
    expect(migration.down).toBeUndefined()
  })
})
