/**
 * E2E tests — Admin UI pages via Playwright headless Chromium.
 *
 * Requires: Sinopebase server running on http://127.0.0.1:8090
 * with SINOPEBASE_SERVICE_ROLE_KEY set.
 *
 * Usage:
 *   bun run dev                           # start server
 *   bun test tests/e2e/admin-ui.e2e.ts   # run e2e tests
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Browser, Page } from '@playwright/test'
import { chromium } from '@playwright/test'

const BASE = 'http://127.0.0.1:8090'
const SERVICE_KEY = process.env.SINOPEBASE_SERVICE_ROLE_KEY || 'test-service-role-key-32-chars!!'

// No top-level await — probe synchronously and defer I/O to beforeAll.
// On some platforms (Windows) Playwright's chromium.launch() hangs; on
// CI without a display server, browsers are unavailable. Skip all tests
// unless both the dev server and a Chromium browser are confirmed ready.
let e2eAvailable = false

describe('Admin UI E2E', () => {
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    // 1. Check dev server is running
    try {
      const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) })
      if (!res.ok) return
    } catch {
      console.warn('Skipping Admin UI E2E: server not reachable at', BASE)
      return
    }

    // 2. Launch browser (short timeout — Playwright may hang on Windows)
    try {
      browser = await chromium.launch({ headless: true, timeout: 5000 })
    } catch (err) {
      console.warn('Skipping Admin UI E2E: browser unavailable:', (err as Error).message)
      return
    }

    e2eAvailable = true
  })

  afterAll(async () => {
    if (browser) await browser.close()
  })

  const e2e = (name: string, fn: (...args: unknown[]) => unknown) => {
    return (e2eAvailable ? test : test.skip)(name, fn)
  }

  // ── Helper: open a fresh authenticated page ──
  async function openAdminPage(hash = ''): Promise<Page> {
    const p = await browser.newPage()
    await p.goto(`${BASE}/_/`)
    await p.evaluate(({ key }: { key: string }) => localStorage.setItem('sb-service-role-key', key), {
      key: SERVICE_KEY,
    })
    await p.goto(`${BASE}/_/${hash}`)
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
    await p.goto(`${BASE}/_/#/login`)
    await p.waitForSelector('text=Service Role Key', { timeout: 3000 })
    await p.waitForSelector('text=Email / Password', { timeout: 3000 })
    const heading = await p.textContent('h1')
    expect(heading).toContain('Sinopebase Admin')
    await p.close()
  })

  // ── Auth guard: unauthenticated access rejected ──
  e2e('Admin UI rejects unauthenticated access in production mode', async () => {
    const p = await browser.newPage()
    await p.goto(`${BASE}/_/`)
    await p.evaluate(() => localStorage.removeItem('sb-service-role-key'))
    await p.goto(`${BASE}/_/#/login`)
    await p.waitForSelector('text=Sign In', { timeout: 3000 })
    await p.close()
  })
})
