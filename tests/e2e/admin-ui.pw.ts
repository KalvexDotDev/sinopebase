/**
 * E2E tests — Admin UI pages via Playwright headless Chromium.
 *
 * Uses @playwright/test runner (Node.js), not bun:test. Bun on Windows
 * cannot launch Playwright Chromium due to an open child_process pipe
 * inheritance bug (oven-sh/bun#27977, #31105). Node.js handles CDP pipes
 * correctly on all platforms.
 *
 * The Bun server is started by webServer config in playwright.config.ts.
 */

import { expect, test } from '@playwright/test'

const BASE = 'http://127.0.0.1:9876'
const serviceKey = process.env.SINOPEBASE_SERVICE_ROLE_KEY || 'e2e-key-service-min-32-chars!!'

async function auth(page: import('@playwright/test').Page) {
  await page.goto(`${BASE}/_/`)
  await page.evaluate(
    ({ key }: { key: string }) => localStorage.setItem('sb-service-role-key', key),
    { key: serviceKey },
  )
}

const pages = [
  { path: '/_/', name: 'Dashboard' },
  { path: '/_/tables', name: 'Table Editor' },
  { path: '/_/auth', name: 'Auth Users' },
  { path: '/_/storage', name: 'Storage' },
  { path: '/_/rls', name: 'RLS Policies' },
  { path: '/_/api', name: 'API Docs' },
  { path: '/_/realtime', name: 'Realtime' },
  { path: '/_/backups', name: 'Backups' },
  { path: '/_/metrics', name: 'Metrics' },
  { path: '/_/settings', name: 'Settings' },
  { path: '/_/logs', name: 'Logs' },
  { path: '/_/ai', name: 'AI' },
  { path: '/_/functions', name: 'Edge Functions' },
]

for (const { path, name } of pages) {
  test(`${name} page loads`, async ({ page }) => {
    await auth(page)
    await page.goto(`${BASE}${path}`)
    // Page should render HTML, not crash or return error
    const title = await page.title()
    expect(title.length).toBeGreaterThan(0)
    // Body should be present
    await expect(page.locator('body')).toBeVisible()
  })
}

test('Login page renders without auth', async ({ page }) => {
  await page.goto(`${BASE}/_/`)
  await expect(page.locator('body')).toBeVisible()
  const title = await page.title()
  expect(title.length).toBeGreaterThan(0)
})
