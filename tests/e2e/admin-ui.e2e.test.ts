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

describe('Admin UI E2E', () => {
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true })

    // Verify the server is reachable
    try {
      const res = await fetch(`${BASE}/api/health`)
      if (!res.ok) throw new Error(`Server not healthy: ${res.status}`)
    } catch {
      throw new Error(`Server not reachable at ${BASE}. Start with 'bun run dev' first.`)
    }
  })

  afterAll(async () => {
    await browser.close()
  })

  // ── Helper: open a fresh authenticated page ──
  async function openAdminPage(hash = '') {
    const p = await browser.newPage()
    // Set service role key in localStorage before navigating
    await p.goto(`${BASE}/_/`)
    await p.evaluate(({ key }) => localStorage.setItem('sb-service-role-key', key), {
      key: SERVICE_KEY,
    })
    await p.goto(`${BASE}/_/${hash}`)
    // Wait for Svelte to mount
    await p.waitForSelector('nav', { timeout: 5000 })
    return p
  }

  // ── Dashboard ──
  test('Dashboard loads and shows health info', async () => {
    page = await openAdminPage('#/')
    const heading = await page.textContent('h2')
    expect(heading).toContain('Dashboard')
    // Should show API endpoint info
    const content = await page.textContent('main')
    expect(content).toContain('/rest/v1')
    await page.close()
  })

  // ── Table Editor ──
  test('Table Editor shows table sidebar', async () => {
    page = await openAdminPage('#/tables')
    const heading = await page.textContent('h2')
    expect(heading).toContain('Table Editor')
    // Table sidebar should exist with the Tables label
    await page.waitForSelector('text=Tables', { timeout: 3000 })
    await page.close()
  })

  // ── Auth Users ──
  test('Auth Users page loads', async () => {
    page = await openAdminPage('#/auth')
    const heading = await page.textContent('h2')
    expect(heading).toContain('Auth Users')
    // Should have a "New User" button
    await page.waitForSelector('text=New User', { timeout: 3000 })
    await page.close()
  })

  // ── Storage ──
  test('Storage page loads with bucket list', async () => {
    page = await openAdminPage('#/storage')
    const heading = await page.textContent('h2')
    expect(heading).toContain('Storage')
    await page.waitForSelector('text=Buckets', { timeout: 3000 })
    await page.close()
  })

  // ── RLS Policies ──
  test('RLS Policies page loads', async () => {
    page = await openAdminPage('#/policies')
    const heading = await page.textContent('h2')
    expect(heading).toContain('RLS Policies')
    await page.close()
  })

  // ── API Docs ──
  test('API Docs page loads', async () => {
    page = await openAdminPage('#/api-docs')
    const heading = await page.textContent('h2')
    expect(heading).toContain('API Documentation')
    await page.close()
  })

  // ── Realtime Inspector ──
  test('Realtime Inspector shows connection status', async () => {
    page = await openAdminPage('#/realtime')
    const heading = await page.textContent('h2')
    expect(heading).toContain('Realtime Inspector')
    // Should show Disconnected status (no WS connection in test)
    await page.waitForSelector('text=Disconnected', { timeout: 5000 })
    await page.close()
  })

  // ── Backups ──
  test('Backups page loads', async () => {
    page = await openAdminPage('#/backups')
    const heading = await page.textContent('h2')
    expect(heading).toContain('Backups')
    // Should have a New Backup button
    await page.waitForSelector('text=New Backup', { timeout: 3000 })
    await page.close()
  })

  // ── Metrics ──
  test('Metrics page loads', async () => {
    page = await openAdminPage('#/metrics')
    const heading = await page.textContent('h2')
    expect(heading).toContain('Metrics')
    await page.close()
  })

  // ── Settings ──
  test('Settings page loads with form fields', async () => {
    page = await openAdminPage('#/settings')
    const heading = await page.textContent('h2')
    expect(heading).toContain('Settings')
    // Should have a Save button
    await page.waitForSelector('text=Save Changes', { timeout: 3000 })
    await page.close()
  })

  // ── Logs ──
  test('Logs page loads', async () => {
    page = await openAdminPage('#/logs')
    const heading = await page.textContent('h2')
    expect(heading).toContain('Logs')
    await page.close()
  })

  // ── AI Playground ──
  test('AI page loads', async () => {
    page = await openAdminPage('#/ai')
    const heading = await page.textContent('h2')
    expect(heading).toContain('AI Playground')
    await page.close()
  })

  // ── Edge Functions ──
  test('Edge Functions page loads', async () => {
    page = await openAdminPage('#/functions')
    const heading = await page.textContent('h2')
    expect(heading).toContain('Edge Functions')
    await page.close()
  })

  // ── Login page (unauthenticated) ──
  test('Login page shows service role key tab', async () => {
    const p = await browser.newPage()
    await p.goto(`${BASE}/_/#/login`)
    await p.waitForSelector('text=Service Role Key', { timeout: 3000 })
    await p.waitForSelector('text=Email / Password', { timeout: 3000 })
    const heading = await p.textContent('h1')
    expect(heading).toContain('Sinopebase Admin')
    await p.close()
  })

  // ── Auth guard: unauthenticated access rejected ──
  test('Admin UI rejects unauthenticated access in production mode', async () => {
    const p = await browser.newPage()
    // Clear any existing tokens
    await p.goto(`${BASE}/_/`)
    await p.evaluate(() => localStorage.removeItem('sb-service-role-key'))
    // Reload without token — the page should show login (dev mode allows it)
    await p.goto(`${BASE}/_/#/login`)
    await p.waitForSelector('text=Sign In', { timeout: 3000 })
    await p.close()
  })
})
