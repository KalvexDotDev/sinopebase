import { expect, test } from '@playwright/test'
import { Pool } from 'pg'

const BASE = 'http://127.0.0.1:9876'
const serviceKey = process.env.SINOPEBASE_SERVICE_ROLE_KEY || 'e2e-key-service-min-32-chars!!'
const headers = { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }
const unique = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

async function signIn(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(`${BASE}/_/`)
  await page.evaluate((key) => localStorage.setItem('sb-service-role-key', key), serviceKey)
  await page.goto(`${BASE}/_/`)
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
}

test('Cron Jobs: editing a handler persists the new value', async ({ page }) => {
  const id = unique('ui_cron')
  const created = await fetch(`${BASE}/api/crons`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id,
      label: 'UI regression',
      schedule: '0 3 * * *',
      handler: 'fn:before',
    }),
  })
  expect(created.ok).toBe(true)

  try {
    await signIn(page)
    await page.goto(`${BASE}/_/#/cron`)
    const row = page.getByRole('row', { name: new RegExp(id) })
    await expect(row).toContainText('fn:before')
    await row.getByRole('button', { name: 'Edit' }).click()
    await page.getByLabel('Handler').fill('fn:after')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(row).toContainText('fn:after')

    const response = await fetch(`${BASE}/api/crons`, { headers })
    const jobs = (await response.json()) as Array<{ id: string; handler: string }>
    expect(jobs.find((job) => job.id === id)?.handler).toBe('fn:after')
  } finally {
    await fetch(`${BASE}/api/crons/${id}`, { method: 'DELETE', headers })
  }
})

test('Storage: UI refuses a nonempty bucket and deletes it after cleanup', async ({ page }) => {
  const name = unique('ui_delete_bucket')
  const file = 'keep.txt'
  const created = await fetch(`${BASE}/storage/v1/bucket`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name, public: false }),
  })
  expect(created.ok).toBe(true)

  try {
    const uploaded = await fetch(`${BASE}/storage/v1/object/${name}/${file}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'text/plain' },
      body: 'retain until explicitly removed',
    })
    expect(uploaded.ok).toBe(true)

    await signIn(page)
    await page.goto(`${BASE}/_/#/storage`)
    await page.getByRole('button', { name, exact: true }).click()
    await expect(page.getByText(file, { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Delete Bucket' }).click()
    await page.getByPlaceholder(name).fill(name)
    await page.getByRole('button', { name: 'Delete Bucket', exact: true }).last().click()
    await expect(page.getByText('Bucket is not empty').first()).toBeVisible()

    const removed = await fetch(`${BASE}/storage/v1/object/${name}`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ paths: [file] }),
    })
    expect(removed.ok).toBe(true)
    await page.getByRole('button', { name: 'Delete Bucket', exact: true }).last().click()
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)
    const buckets = (await (
      await fetch(`${BASE}/storage/v1/bucket`, { headers })
    ).json()) as Array<{ name: string }>
    expect(buckets.some((bucket) => bucket.name === name)).toBe(false)
  } finally {
    await fetch(`${BASE}/storage/v1/object/${name}`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ paths: [file] }),
    })
    await fetch(`${BASE}/storage/v1/bucket/${name}`, { method: 'DELETE', headers })
  }
})

test('Logs: viewing and refreshing logs does not persist requests for the log viewer', async ({
  page,
}) => {
  const pool = new Pool({
    connectionString:
      process.env.TEST_POSTGRES_URL ||
      'postgresql://sinopebase:sinopebase@127.0.0.1:5432/sinopebase',
  })
  const count = async () => {
    const result = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM _logs WHERE message = 'GET /api/logs'",
    )
    return Number(result.rows[0]?.n ?? 0)
  }

  try {
    const before = await count()
    await signIn(page)
    await page.goto(`${BASE}/_/#/logs`)
    await expect(page.getByRole('heading', { name: 'Logs' })).toBeVisible()
    for (let i = 0; i < 3; i++) {
      const response = await fetch(`${BASE}/api/logs?perPage=10`, { headers })
      expect(response.ok).toBe(true)
    }
    await page.waitForTimeout(200)
    expect(await count()).toBe(before)
  } finally {
    await pool.end()
  }
})

test('AI playground keeps chat controls inside a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 })
  await signIn(page)
  await page.goto(`${BASE}/_/#/ai`)
  const chatInput = page.getByPlaceholder('Type a message…')
  await expect(chatInput).toBeVisible()
  const box = await chatInput.boundingBox()
  if (!box) throw new Error('AI chat input has no visible bounds')
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(900)
  await chatInput.fill('UI regression probe')
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled()
})
