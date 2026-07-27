/**
 * PocketBase-native API Tests — Settings, Logs, Cron, Backup, Health, Batch
 *
 * Tests for settings.ts, logs.ts, cron.ts, backup.ts, health.ts, batch.ts handlers.
 */

import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { type BackupFileInfo, type BackupManager, createBackupPlugin } from '../../src/apis/backup'
import { createBatchPlugin } from '../../src/apis/batch'

/** Loose test-response accessor — narrower than `any`. */
interface TestResponse {
  [key: string]: unknown
}

/** Minimal DB interface for test plugin wiring. */
interface TestDb {
  select(table: string, options?: Record<string, unknown>): Promise<unknown>
  insert(table: string, record: Record<string, unknown>): Promise<unknown>
  update(
    table: string,
    filters: Record<string, unknown>[],
    data: Record<string, unknown>,
  ): Promise<unknown>
  delete(table: string, filters: Record<string, unknown>[]): Promise<unknown>
  count(table: string, filters?: Record<string, unknown>[]): Promise<number>
}

import { type CronJobDescriptor, type CronManager, createCronPlugin } from '../../src/apis/cron'
import { createHealthPlugin, healthResponse } from '../../src/apis/health'
import { createLogsPlugin } from '../../src/apis/logs'
import { type AppSettings, createSettingsPlugin } from '../../src/apis/settings'
import { MemoryDatabase } from '../../src/core/db-memory'

// ---------------------------------------------------------------------------
// Simulate request helper
// ---------------------------------------------------------------------------

async function request(
  app: Elysia,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
) {
  const url = new URL(`http://localhost${path}`)
  const req = new Request(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })

  const response = await app.handle(req)
  const status = response.status
  let data: unknown = null
  const text = await response.text()
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  return { status, data }
}

// ---------------------------------------------------------------------------
// Settings Tests
// ---------------------------------------------------------------------------

describe('Settings API', () => {
  let currentSettings: AppSettings = {
    appName: 'Sinopebase',
    allowSignups: true,
    maxFileSize: 52428800,
  }

  async function updateSettings(newSettings: AppSettings) {
    currentSettings = { ...currentSettings, ...newSettings }
  }

  const settingsPlugin = createSettingsPlugin(
    () => currentSettings,
    updateSettings,
    () => true,
  )

  it('GET /api/settings — returns settings', async () => {
    const { status, data } = await request(settingsPlugin, 'GET', '/api/settings')
    expect(status).toBe(200)
    const result = data as AppSettings
    expect(result.appName).toBe('Sinopebase')
    expect(result.allowSignups).toBe(true)
  })

  it('PATCH /api/settings — updates settings', async () => {
    const { status, data } = await request(settingsPlugin, 'PATCH', '/api/settings', {
      appName: 'Updated App',
      allowSignups: false,
    })
    expect(status).toBe(200)
    const result = data as AppSettings
    expect(result.appName).toBe('Updated App')
    expect(result.allowSignups).toBe(false)
  })

  it('blocks non-superusers', async () => {
    const restrictedPlugin = createSettingsPlugin(
      () => currentSettings,
      updateSettings,
      () => false,
    )
    const { status } = await request(restrictedPlugin, 'GET', '/api/settings')
    expect(status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// Logs Tests
// ---------------------------------------------------------------------------

describe('Logs API', () => {
  const db = new MemoryDatabase()
  db.createTable('_logs')

  // Insert test logs using MemoryDatabase API
  db.insert('_logs', [
    {
      id: 'log1',
      level: 4,
      message: 'Test info log',
      created: new Date().toISOString(),
    },
  ])
  db.insert('_logs', [
    {
      id: 'log2',
      level: 8,
      message: 'Test error log',
      created: new Date().toISOString(),
    },
  ])

  const logsPlugin = createLogsPlugin(db as TestDb, () => true)

  it('GET /api/logs — lists logs', async () => {
    const { status, data } = await request(logsPlugin, 'GET', '/api/logs')
    expect(status).toBe(200)
    const result = data as TestResponse
    expect(result.items).toBeInstanceOf(Array)
    expect(result.totalItems).toBeGreaterThanOrEqual(2)
  })

  it('GET /api/logs/stats — returns stats', async () => {
    const { status, data } = await request(logsPlugin, 'GET', '/api/logs/stats')
    expect(status).toBe(200)
    expect(Array.isArray(data)).toBe(true)
  })

  it('GET /api/logs/:id — views a log entry', async () => {
    const { status, data } = await request(logsPlugin, 'GET', '/api/logs/log1')
    expect(status).toBe(200)
    expect((data as TestResponse).id).toBe('log1')
  })

  it('blocks non-superusers', async () => {
    const db2 = new MemoryDatabase()
    db2.createTable('_logs')
    const restrictedPlugin = createLogsPlugin(db2 as TestDb, () => false)
    const { status } = await request(restrictedPlugin, 'GET', '/api/logs')
    expect(status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// Cron Tests
// ---------------------------------------------------------------------------

describe('Cron API', () => {
  const jobs: CronJobDescriptor[] = [
    { id: 'cleanup', label: 'Cleanup old data', schedule: '0 0 * * *' },
    { id: 'backup', label: 'Daily backup', schedule: '0 2 * * *' },
  ]

  let lastRunJob: string | null = null

  const cronManager: CronManager = {
    listJobs: () => jobs,
    runJob: (jobId: string) => {
      const found = jobs.find((j) => j.id === jobId)
      if (found) {
        lastRunJob = jobId
        return true
      }
      return false
    },
  }

  const cronPlugin = createCronPlugin(cronManager, () => true)

  it('GET /api/crons — lists cron jobs', async () => {
    const { status, data } = await request(cronPlugin, 'GET', '/api/crons')
    expect(status).toBe(200)
    const result = data as CronJobDescriptor[]
    expect(result.length).toBe(2)
    expect(result[0]?.id).toBe('cleanup')
  })

  it('POST /api/crons/:id — runs a cron job', async () => {
    const { status } = await request(cronPlugin, 'POST', '/api/crons/cleanup')
    expect(status).toBe(204)
    expect(lastRunJob).toBe('cleanup')
  })

  it('returns 404 for unknown job', async () => {
    const { status } = await request(cronPlugin, 'POST', '/api/crons/unknown')
    expect(status).toBe(404)
  })

  it('blocks non-superusers', async () => {
    const restrictedPlugin = createCronPlugin(cronManager, () => false)
    const { status } = await request(restrictedPlugin, 'GET', '/api/crons')
    expect(status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// Backup Tests
// ---------------------------------------------------------------------------

describe('Backup API', () => {
  let backups: BackupFileInfo[] = [
    { key: 'backup-2024-01-01.zip', size: 1024, modified: '2024-01-01T00:00:00Z' },
    { key: 'backup-2024-01-02.zip', size: 2048, modified: '2024-01-02T00:00:00Z' },
  ]

  const backupManager: BackupManager = {
    listBackups: async () => backups,
    createBackup: async (name: string) => {
      backups.push({ key: name, size: 0, modified: new Date().toISOString() })
    },
    deleteBackup: async (key: string) => {
      backups = backups.filter((b) => b.key !== key)
    },
    restoreBackup: async () => {},
    downloadBackup: async () => null,
  }

  const backupPlugin = createBackupPlugin(backupManager, () => true)

  it('GET /api/backups — lists backups', async () => {
    const { status, data } = await request(backupPlugin, 'GET', '/api/backups')
    expect(status).toBe(200)
    const result = data as BackupFileInfo[]
    expect(result.length).toBe(2)
  })

  it('POST /api/backups — creates a backup', async () => {
    const { status } = await request(backupPlugin, 'POST', '/api/backups', {
      name: 'manual-backup.zip',
    })
    expect(status).toBe(204)
  })

  it('DELETE /api/backups/:name — deletes a backup', async () => {
    const { status } = await request(backupPlugin, 'DELETE', '/api/backups/backup-2024-01-01.zip')
    expect(status).toBe(204)
  })

  it('POST /api/backups/:name/restore — restores a backup', async () => {
    const { status } = await request(
      backupPlugin,
      'POST',
      '/api/backups/backup-2024-01-02.zip/restore',
    )
    expect(status).toBe(204)
  })

  it('blocks non-superusers', async () => {
    const restrictedPlugin = createBackupPlugin(backupManager, () => false)
    const { status } = await request(restrictedPlugin, 'GET', '/api/backups')
    expect(status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// Health Tests
// ---------------------------------------------------------------------------

describe('Health API', () => {
  it('GET /api/health — returns healthy', async () => {
    const healthPlugin = createHealthPlugin()
    const { status, data } = await request(healthPlugin, 'GET', '/api/health')
    expect(status).toBe(200)
    const result = data as TestResponse
    expect(result.code).toBe(200)
    expect(result.message).toBe('API is healthy.')
  })

  it('healthResponse() returns standard response', () => {
    const resp = healthResponse()
    expect(resp.code).toBe(200)
    expect(resp.message).toBe('API is healthy.')
  })

  it('includes extra data when options provided', async () => {
    const healthPlugin = createHealthPlugin({ canBackup: true, realIP: '10.0.0.1' })
    const { status, data } = await request(healthPlugin, 'GET', '/api/health')
    expect(status).toBe(200)
    const result = data as TestResponse
    expect(result.data.canBackup).toBe(true)
    expect(result.data.realIP).toBe('10.0.0.1')
  })
})

// ---------------------------------------------------------------------------
// Batch Tests
// ---------------------------------------------------------------------------

describe('Batch API', () => {
  it('POST /api/batch — accepts batch requests', async () => {
    const db = new MemoryDatabase()
    const app = new Elysia()
    const batchPlugin = createBatchPlugin(db as TestDb, () => true, app)

    const { status, data } = await request(batchPlugin, 'POST', '/api/batch', {
      requests: [
        { method: 'GET', url: '/api/health' },
        { method: 'GET', url: '/api/collections' },
      ],
    })

    expect(status).toBe(200)
    expect(Array.isArray(data)).toBe(true)
  })

  it('rejects empty batch requests', async () => {
    const db = new MemoryDatabase()
    const app = new Elysia()
    const batchPlugin = createBatchPlugin(db as TestDb, () => true, app)

    const { status } = await request(batchPlugin, 'POST', '/api/batch', { requests: [] })
    expect(status).toBe(400)
  })

  it('rejects requests without requests array', async () => {
    const db = new MemoryDatabase()
    const app = new Elysia()
    const batchPlugin = createBatchPlugin(db as TestDb, () => true, app)

    const { status } = await request(batchPlugin, 'POST', '/api/batch', {})
    expect(status).toBe(400)
  })
})
