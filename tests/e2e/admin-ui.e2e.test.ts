/**
 * E2E tests — Admin UI pages via Playwright headless Chromium.
 *
 * Starts its own Sinopebase server in beforeAll — no pre-running server needed.
 * Skips on platforms where Playwright browser is unavailable (e.g. headless CI).
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Browser, Page } from '@playwright/test'
import { chromium } from '@playwright/test'
import { Sinopebase } from '~/core/app'

// Probe browser availability at module load. Playwright's headless Chromium
// can hang at the OS level on Windows (process-spawn syscall blocks the JS
// event loop, no Promise timeout can interrupt it). On CI (ubuntu-latest)
// launch is near-instant. Skip on Windows, probe on other platforms.
let browserAvailable = false
if (process.platform !== 'win32') {
  try {
    const b = await chromium.launch({ headless: true, timeout: 10000 })
    await b.close()
    browserAvailable = true
  } catch {
    // browser unavailable — all E2E tests will skip
  }
}
const e2e = browserAvailable ? test : test.skip

describe('Admin UI E2E', () => {
  let browser: Browser
  let page: Page
  let app: Sinopebase
  let baseUrl: string

  beforeAll(async () => {
    if (!browserAvailable) return

    browser = await chromium.launch({ headless: true })

    // Start sinopebase server connected to local PG
    const pgUrl = process.env.TEST_POSTGRES_URL || process.env.POSTGRES_URL || ''
    if (!pgUrl) throw new Error('E2E requires TEST_POSTGRES_URL or POSTGRES_URL')
    app = new Sinopebase({
      port: 0,
      host: '127.0.0.1',
      postgresUrl: pgUrl,
      jwtSecret: 'e2e-jwt-secret-min-32-chars!!!',
      serviceRoleKey: 'e2ekey-service-min-32-chars!!!!',
      anonKey: 'e2ekey-anon-min-32-chars!!!!!!!',
    })
    await app.start()
    const port = app.getConfig().port ?? 0
    baseUrl = `http://127.0.0.1:${port}`
  })

  afterAll(async () => {
    if (browser) await browser.close()
    if (app) await app.stop()
  })

  // ── Helper: open a fresh authenticated page ──
  const serviceKey = 'e2ekey-service-min-32-chars!!!!'

  async function openAdminPage(hash = ''): Promise<Page> {
    const p = await browser.newPage()
    await p.goto(`${baseUrl}/_/`)
    await p.evaluate(({ key }: { key: string }) => localStorage.setItem('sb-service-role-key', key), {
      key: serviceKey,
    })
    await p.goto(`${baseUrl}/_/${hash}`)
    await p.waitForSelector('nav', { timeout: 5000 })
    return p
  }

  // ── Dashboard ──
  e2e('Dashboard loads and shows health info', async () => {
    page = await openAdminPage('#/')
    const heading = await page.textContent('h2')
    expect(heading).toContain('Dashboard')
    const content = await page.textContent('main')
    expect(content).toContain('/rest/v1')
    await page.close()
  })

  // ── Table Editor ──
  e2e('Table Editor shows table sidebar', async () => {
    page = await openAdminPage('#/tables')
    const heading = await page.textContent('h2')
    expect(heading).toContain('Table Editor')
    await page.waitForSelector('text=Tables', { timeout: 3000 })
    await page.close()
  })

  // ── Auth Users ──
  e2e('Auth Users page loads', async () => {
    page = await openAdminPage('#/auth')
    const heading = await page.textContent('h2')
    expect(heading).toContain('Auth Users')
    await page.waitForSelector('text=New User', { timeout: 3000 })
    await page.close()
  })

  // ── Storage ──
  e2e('Storage page loads with bucket list', async () => {
    page = await openAdminPage('#/storage')
    const heading = await page.textContent('h2')
    expect(heading).toContain('Storage')
    await page.waitForSelector('text=Buckets', { timeout: 3000 })
    await page.close()
  })

  // ── RLS Policies ──
  e2e('RLS Policies page loads', async () => {
    page = await openAdminPage('#/policies')
    const heading = await page.textContent('h2')
    expect(heading).toContain('RLS Policies')
    await page.close()
  })

  // ── API Docs ──
  e2e('API Docs page loads', async () => {
    page = await openAdminPage('#/api-docs')
    const heading = await page.textContent('h2')
    expect(heading).toContain('API Documentation')
    await page.close()
  })

  // ── Realtime Inspector ──
  e2e('Realtime Inspector shows connection status', async () => {
    page = await openAdminPage('#/realtime')
    const heading = await page.textContent('h2')
    expect(heading).toContain('Realtime Inspector')
    await page.waitForSelector('text=Disconnected', { timeout: 5000 })
    await page.close()
  })

  // ── Backups ──
  e2e('Backups page loads', async () => {
    page = await openAdminPage('#/backups')
    const heading = await page.textContent('h2')
    expect(heading).toContain('Backups')
    await page.waitForSelector('text=New Backup', { timeout: 3000 })
    await page.close()
  })

  // ── Metrics ──
  e2e('Metrics page loads', async () => {
    page = await openAdminPage('#/metrics')
    const heading = await page.textContent('h2')
    expect(heading).toContain('Metrics')
    await page.close()
  })

  // ── Settings ──
  e2e('Settings page loads with form fields', async () => {
    page = await openAdminPage('#/settings')
    const heading = await page.textContent('h2')
    expect(heading).toContain('Settings')
    await page.waitForSelector('text=Save Changes', { timeout: 3000 })
    await page.close()
  })

  // ── Logs ──
  e2e('Logs page loads', async () => {
    page = await openAdminPage('#/logs')
    const heading = await page.textContent('h2')
    expect(heading).toContain('Logs')
    await page.close()
  })

  // ── AI Playground ──
  e2e('AI page loads', async () => {
    page = await openAdminPage('#/ai')
    const heading = await page.textContent('h2')
    expect(heading).toContain('AI Playground')
    await page.close()
  })

  // ── Edge Functions ──
  e2e('Edge Functions page loads', async () => {
    page = await openAdminPage('#/functions')
    const heading = await page.textContent('h2')
    expect(heading).toContain('Edge Functions')
    await page.close()
  })

  // ── Login page (unauthenticated) ──
  e2e('Login page shows service role key tab', async () => {
    const p = await browser.newPage()
    await p.goto(`${baseUrl}/_/#/login`)
    await p.waitForSelector('text=Service Role Key', { timeout: 3000 })
    await p.waitForSelector('text=Email / Password', { timeout: 3000 })
    const heading = await p.textContent('h1')
    expect(heading).toContain('Sinopebase Admin')
    await p.close()
  })

  // ── Auth guard: unauthenticated access rejected ──
  e2e('Admin UI rejects unauthenticated access in production mode', async () => {
    const p = await browser.newPage()
    await p.goto(`${baseUrl}/_/`)
    await p.evaluate(() => localStorage.removeItem('sb-service-role-key'))
    await p.goto(`${baseUrl}/_/#/login`)
    await p.waitForSelector('text=Sign In', { timeout: 3000 })
    await p.close()
  })
})
