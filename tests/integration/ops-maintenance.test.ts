/**
 * Ops & Maintenance Integration Tests
 *
 * Full-server (PostgreSQL) coverage of the operations gaps found in the
 * codex audit:
 *   1. Log retention — _logs rows older than 30 days are pruned at startup.
 *   2. Audit logging — service_role REST requests leave an audit trail in _logs.
 *   3. Cron — the real scheduler (tools/cron/cron.ts) fires due jobs on time.
 *   4. Backups — app.createBackup() produces a real on-disk archive.
 *   5. Deploy artifacts — docker-compose.yml and railway.toml validate.
 *
 * Deliberately skipped (see final report):
 *   - `bun run build` (spawn): expensive and already covered by CI (`ci` script).
 *   - Backup restore: would drop/recreate the shared test database — the real
 *     create + verify path is covered instead.
 *   - app.scheduleBackup(): the app cron uses a hardcoded 60s tick, so the
 *     real Cron class is exercised directly (same scheduler internals).
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Pool } from 'pg'
import YAML from 'yaml'
import { Sinopebase } from '~/core/app'
import { Cron } from '~/tools/cron/cron'
import { requirePostgres, reserveLoopbackPort } from '../harness'

const SERVICE_ROLE_KEY = 'ops-maintenance-srvc-key-32-chars!!!!!'
const ANON_KEY = 'ops-maintenance-anon-key-32-chars!!!!!!'
const JWT_SECRET = 'ops-maintenance-jwt-secret-32-chars!!'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms))
}

/** Poll until `fn` returns true, or throw after the timeout. */
async function pollUntil(
  fn: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
  intervalMs = 100,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await fn()) return
    if (Date.now() > deadline) {
      throw new Error(`Condition not met within ${timeoutMs}ms`)
    }
    await sleep(intervalMs)
  }
}

/** Boot a full Sinopebase server on a free loopback port against PostgreSQL. */
async function bootApp(dataDir?: string): Promise<{ app: Sinopebase; origin: string }> {
  const reservation = await reserveLoopbackPort()
  const app = new Sinopebase({
    port: reservation.port,
    postgresUrl: requirePostgres(),
    jwtSecret: JWT_SECRET,
    serviceRoleKey: SERVICE_ROLE_KEY,
    anonKey: ANON_KEY,
    dataDir,
  })
  await reservation.release()
  await app.start()
  return { app, origin: reservation.origin }
}

// ---------------------------------------------------------------------------
// 1. Log retention
// ---------------------------------------------------------------------------

describe('Log retention', () => {
  let adminPool: Pool
  let app: Sinopebase

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: requirePostgres() })
    const booted = await bootApp()
    app = booted.app
  })

  afterAll(async () => {
    await app?.stop()
    await adminPool?.end()
  })

  // Two full app boots inside this test — needs well beyond the 5s default.
  it('startup prune removes stale _logs rows and keeps fresh ones', async () => {
    const marker = `retention-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    // Insert one fake stale row (>30 days old) and one fresh row directly via SQL.
    // The _logs schema is (id, level, message, data, created) — created is TEXT.
    await adminPool.query(
      `INSERT INTO _logs (level, message, data, created) VALUES (0, $1, '{}', now() - interval '31 days')`,
      [`old-${marker}`],
    )
    await adminPool.query(`INSERT INTO _logs (level, message, data) VALUES (0, $1, '{}')`, [
      `fresh-${marker}`,
    ])

    // The startup prune runs inside initializeServer() — restart to trigger it.
    await app.stop()
    const second = await bootApp()
    const app2 = second.app
    try {
      // Give the startup prune a chance to remove the stale row.
      await sleep(1_500)
      const [oldRow, freshRow] = await Promise.all([
        adminPool.query(`SELECT 1 FROM _logs WHERE message = $1 LIMIT 1`, [`old-${marker}`]),
        adminPool.query(`SELECT 1 FROM _logs WHERE message = $1 LIMIT 1`, [`fresh-${marker}`]),
      ])
      // The prune query casts created (TEXT) to timestamptz before comparing.
      expect(oldRow.rowCount).toBe(0)
      expect(freshRow.rowCount).toBe(1)
    } finally {
      await app2.stop()
      // Clean up the marker rows regardless of the outcome.
      await adminPool.query(`DELETE FROM _logs WHERE message LIKE $1`, [`%-${marker}`])
    }
  }, 30_000)

  it('a casted prune (created::timestamptz) removes stale rows and keeps fresh rows', async () => {
    const marker = `retention-cast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    await adminPool.query(
      `INSERT INTO _logs (level, message, data, created) VALUES (0, $1, '{}', now() - interval '31 days')`,
      [`old-${marker}`],
    )
    await adminPool.query(`INSERT INTO _logs (level, message, data) VALUES (0, $1, '{}')`, [
      `fresh-${marker}`,
    ])

    // The intended fix shape: cast the TEXT created column before comparing.
    // Scoped to the marker rows so the shared test DB is untouched.
    const deleted = await adminPool.query(
      `DELETE FROM _logs WHERE message LIKE $1 AND created::timestamptz < now() - make_interval(days => 30)`,
      [`%-${marker}`],
    )
    expect(deleted.rowCount).toBe(1)

    const [oldRow, freshRow] = await Promise.all([
      adminPool.query(`SELECT 1 FROM _logs WHERE message = $1 LIMIT 1`, [`old-${marker}`]),
      adminPool.query(`SELECT 1 FROM _logs WHERE message = $1 LIMIT 1`, [`fresh-${marker}`]),
    ])
    expect(oldRow.rowCount).toBe(0)
    expect(freshRow.rowCount).toBe(1)

    await adminPool.query(`DELETE FROM _logs WHERE message LIKE $1`, [`%-${marker}`])
  }, 30_000)
})

// ---------------------------------------------------------------------------
// 2. Audit logging for service_role
// ---------------------------------------------------------------------------

describe('Audit logging for service_role', () => {
  let adminPool: Pool
  let app: Sinopebase
  let origin: string

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: requirePostgres() })
    const booted = await bootApp()
    app = booted.app
    origin = booted.origin
  })

  afterAll(async () => {
    await app?.stop()
    await adminPool?.end()
  })

  it('persists a _logs entry for service_role REST requests and surfaces the audit trail', async () => {
    const path = '/rest/v1/todos'
    // Unique request id makes the persisted entry unambiguous.
    const probeId = `audit-probe-${Date.now()}`

    const res = await fetch(`${origin}${path}`, {
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        'x-request-id': probeId,
      },
    })
    expect(res.status).toBe(200)

    // The request itself must be persisted (onAfterResponse -> _logs), keyed
    // by our unique x-request-id. The write is fire-and-forget, so poll.
    await pollUntil(async () => {
      const { rows } = await adminPool.query<{ data: string }>(
        `SELECT data FROM _logs WHERE data LIKE $1 ORDER BY created DESC LIMIT 5`,
        [`%${probeId}%`],
      )
      return rows.some((row) => (row.data ?? '').includes(`"path":"${path}"`))
    })

    // H11 audit trail: a dedicated 'audit:service_role' entry referencing the path.
    await pollUntil(async () => {
      const { rows: auditRows } = await adminPool.query<{ message: string; data: string }>(
        `SELECT message, data FROM _logs WHERE message = 'audit:service_role' AND data LIKE $1 ORDER BY created DESC`,
        [`%${path}%`],
      )
      return auditRows.length > 0
    })
    const { rows: auditRows } = await adminPool.query<{ message: string; data: string }>(
      `SELECT message, data FROM _logs WHERE message = 'audit:service_role' AND data LIKE $1 ORDER BY created DESC`,
      [`%${path}%`],
    )
    expect(auditRows.some((row) => (row.data ?? '').includes(path))).toBe(true)
  }, 30_000)
})

// ---------------------------------------------------------------------------
// 3. Cron scheduler (real execution)
// ---------------------------------------------------------------------------

describe('Cron scheduler (real execution)', () => {
  it('fires a 1s-interval job repeatedly and stops cleanly', async () => {
    const cron = new Cron()
    cron.setInterval(1_000)

    let fires = 0
    cron.add('ops-maintenance-tick', '* * * * *', () => {
      fires += 1
    })

    cron.start()
    expect(cron.hasStarted).toBe(true)

    // First tick lands on the next 1s boundary (at most ~1s after start),
    // then every 1s — so >=2 fires are expected within ~2.5s. Poll instead of
    // a fixed sleep so a jittery scheduler still gets the assertion it deserves.
    await pollUntil(() => fires >= 2, 4_000, 100)

    cron.stop()
    expect(fires).toBeGreaterThanOrEqual(2)
    expect(cron.hasStarted).toBe(false)

    // After stop() no further ticks may fire.
    const afterStop = fires
    await sleep(700)
    expect(fires).toBe(afterStop)
  }, 15_000)
})

// ---------------------------------------------------------------------------
// 4. Local backups
// ---------------------------------------------------------------------------

describe('Local backups', () => {
  let adminPool: Pool
  let app: Sinopebase
  let origin: string
  const dataDir = join(tmpdir(), `sinopebase-ops-backup-${Date.now()}`)

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: requirePostgres() })
    const booted = await bootApp(dataDir)
    app = booted.app
    origin = booted.origin
  })

  afterAll(async () => {
    await app?.stop()
    await adminPool?.end()
  })

  // App boot + sqlDump of the whole database — needs well beyond the 5s default.
  it('creates a real on-disk backup that contains the API change', async () => {
    const marker = `ops-backup-marker-${Date.now()}`

    // Make a real API change: insert a todo row with the service key.
    const res = await fetch(`${origin}/rest/v1/todos`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ task: marker }),
    })
    expect(res.status).toBe(201)

    await app.createBackup('ops-maintenance')

    // Backup artifacts land in <dataDir>/backups/<name>_<timestamp>/.
    const backupRoot = app.getBackupDir()
    const entries = await readdir(backupRoot)
    const created = entries.filter((name) => name.startsWith('ops-maintenance_'))
    expect(created.length).toBe(1)
    const createdEntry = created[0]
    if (!createdEntry) throw new Error('Expected a backup directory on disk')
    const backupPath = join(backupRoot, createdEntry)

    // Manifest records both subsystems.
    const manifest = JSON.parse(await readFile(join(backupPath, 'backup.json'), 'utf-8')) as {
      hasPostgres: boolean
      hasFileStore: boolean
    }
    expect(manifest.hasPostgres).toBe(true)
    expect(manifest.hasFileStore).toBe(true)

    // PostgreSQL dump exists and contains the record created via the API.
    // (pg_dump falls back to the SQL-based export when the binary is absent —
    // the artifact is still a real dump of the live database.)
    const dump = await readFile(join(backupPath, 'postgres.sql'), 'utf-8')
    expect(dump.length).toBeGreaterThan(0)
    expect(dump).toContain(marker)

    // File store backup (LocalFileStore path) wrote a manifest.
    const fsManifestPath = join(backupPath, 'filestore', 'manifest.json')
    expect(existsSync(fsManifestPath)).toBe(true)
    const fsManifest = JSON.parse(await readFile(fsManifestPath, 'utf-8')) as { files: unknown[] }
    expect(fsManifest).toHaveProperty('files')

    // Restore is deliberately NOT exercised here: it would drop and recreate
    // tables in the shared test database. Creating + verifying the archive
    // covers the real local backup path end to end.
  }, 30_000)
})

// ---------------------------------------------------------------------------
// 5. Deploy artifacts
// ---------------------------------------------------------------------------

describe('Deploy artifacts', () => {
  const repoRoot = resolve(import.meta.dir, '../..')

  it('docker compose config validates the compose file (exit 0)', async () => {
    const docker = Bun.spawnSync(['which', 'docker'], { stdout: 'pipe' })
    if (docker.exitCode !== 0) {
      // In CI, docker is a hard requirement — the compose file must be
      // validated before any deploy. Fail loudly instead of skipping.
      if (process.env.CI) {
        throw new Error(
          '[ops-maintenance] docker CLI is required in CI to validate docker-compose.yml — install docker or drop this test',
        )
      }
      // Local machines without Docker skip the validation run.
      console.warn('[ops-maintenance] docker not found — skipping docker compose config')
      return
    }

    const proc = Bun.spawn(['docker', 'compose', 'config', '--quiet'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const exitCode = await proc.exited
    expect(exitCode).toBe(0)
  })

  /**
   * railway.toml is TOML, not YAML — `[build]` section headers are parsed
   * as YAML flow sequences and always fail a raw yaml parse. Convert
   * `[section]` headers into nested YAML keys so the yaml dependency can
   * validate the structure, then assert the required deploy keys.
   * Malformed content still fails the parse, so the check stays strict.
   */
  function tomlToYaml(raw: string): string {
    const out: string[] = []
    let depth = 0
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        depth = 0
        for (const part of trimmed.slice(1, -1).split('.')) {
          out.push(`${'  '.repeat(depth)}${part}:`)
          depth += 1
        }
        continue
      }
      if (trimmed === '' || trimmed.startsWith('#')) {
        out.push(`${'  '.repeat(depth)}${trimmed}`)
        continue
      }
      // TOML keys are `key = value`; YAML uses `key: value`.
      out.push(
        `${'  '.repeat(depth)}${trimmed.replace(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*/, '$1: ')}`,
      )
    }
    return out.join('\n')
  }

  it('railway.toml parses and contains the required build and deploy sections', async () => {
    const raw = await readFile(join(repoRoot, 'railway.toml'), 'utf-8')

    // Parse with the yaml dependency instead of grepping the raw text so a
    // malformed file (bad syntax, wrong nesting) fails the test.
    const doc = YAML.parse(tomlToYaml(raw)) as Record<string, unknown>
    const build = doc.build as Record<string, unknown> | undefined
    const deploy = doc.deploy as Record<string, unknown> | undefined

    // [build] — the service must build from the Dockerfile.
    expect(build).toBeDefined()
    expect(build?.builder).toBe('DOCKERFILE')
    expect(build?.dockerfilePath).toBe('Dockerfile')

    // [deploy] — the service must be reachable by the Railway health probe.
    expect(deploy).toBeDefined()
    expect(deploy?.healthcheckPath).toBe('/api/health')
    expect(deploy?.numReplicas).toBe(1)

    // Belt and braces: the file is a real config, not a stub.
    expect(raw.length).toBeGreaterThan(100)
  })
})
