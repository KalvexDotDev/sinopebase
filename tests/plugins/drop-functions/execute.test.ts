// ---------------------------------------------------------------------------
// DropFunctions — Integration tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { Sinopebase } from '~/core/app'
import { DropFunctionsPlugin } from '~/plugins/drop-functions/plugin'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'

const TEST_FUNCTIONS_DIR = resolve(import.meta.dirname ?? '.', '../../test-functions')

function writeTestFunction(name: string, source: string): void {
  const dir = resolve(TEST_FUNCTIONS_DIR)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name + '.ts'), source, 'utf-8')
}

function cleanupTestFunctions(): void {
  try { rmSync(TEST_FUNCTIONS_DIR, { recursive: true, force: true }) } catch { /* ok */ }
}

describe('DropFunctions Plugin', () => {
  let app: Sinopebase
  let baseUrl: string
  let plugin: DropFunctionsPlugin
  let authToken = ''

  beforeAll(async () => {
    cleanupTestFunctions()

    // Write a test function
    writeTestFunction('hello', `
      export const config = { auth: false }
      export default async function handler(req, ctx) {
        const name = new URL(req.url).searchParams.get('name') || 'world'
        return { message: 'Hello, ' + name + '!', requestId: ctx.requestId }
      }
    `)

    // Write an auth-required function
    writeTestFunction('protected', `
      export const config = { auth: true }
      export default async function handler(req, ctx) {
        return { user: ctx.auth, message: 'This is protected' }
      }
    `)

    // Write a slow function (for timeout testing)
    writeTestFunction('slow', `
      export const config = { timeout: 500 }
      export default async function handler(req, ctx) {
        await new Promise(resolve => setTimeout(resolve, 2000))
        return { done: true }
      }
    `)

    app = new Sinopebase({
      port: 8093,
      postgresUrl: process.env.TEST_POSTGRES_URL || '',
    })
    await app.start()

    plugin = new DropFunctionsPlugin({
      functionsDir: TEST_FUNCTIONS_DIR,
      defaultTimeout: 5000,
    })
    await plugin.register(app['server'] as any, (app as any).getAuth?.())

    baseUrl = 'http://127.0.0.1:8093'

    // Sign up and get an auth token for management CRUD tests
    const signupRes = await fetch(baseUrl + '/auth/v1/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'fn-admin-' + Date.now() + '@test.com', password: 'secure-admin-password-99' })
    })
    const signupJson = await signupRes.json() as any
    console.log('Signup status:', signupRes.status, 'body:', JSON.stringify(signupJson).slice(0, 200))
    authToken = signupJson.data?.session?.access_token || ''
  })

  afterAll(async () => {
    await app.stop()
    cleanupTestFunctions()
  })

  // -----------------------------------------------------------------------
  // HTTP execution
  // -----------------------------------------------------------------------

  it('executes a public function', async () => {
    const res = await fetch(baseUrl + '/api/functions/v1/hello?name=Sinopebase')
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.data.message).toBe('Hello, Sinopebase!')
    expect(json.data.requestId).toBeTruthy()
  })

  it('returns requestId and functionName in response', async () => {
    const res = await fetch(baseUrl + '/api/functions/v1/hello')
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.requestId).toBeTruthy()
    expect(json.functionName).toBe('hello')
  })

  // -----------------------------------------------------------------------
  // Auth
  // -----------------------------------------------------------------------

  it('rejects protected function without auth', async () => {
    const res = await fetch(baseUrl + '/api/functions/v1/protected')
    expect(res.status).toBe(401)
  })

  // -----------------------------------------------------------------------
  // Not found
  // -----------------------------------------------------------------------

  it('returns 404 for unknown function', async () => {
    const res = await fetch(baseUrl + '/api/functions/v1/nonexistent')
    expect(res.status).toBe(404)
  })

  // -----------------------------------------------------------------------
  // Management CRUD
  // -----------------------------------------------------------------------

  it('lists all functions', async () => {
    const res = await fetch(baseUrl + '/api/functions/v1', {
      headers: { Authorization: 'Bearer ' + authToken }
    })
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.data).toBeInstanceOf(Array)
    expect(json.data.length).toBeGreaterThanOrEqual(3)
  })

  it('gets function source', async () => {
    const res = await fetch(baseUrl + '/api/functions/v1/hello/source', {
      headers: { Authorization: 'Bearer ' + authToken }
    })
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.data.name).toBe('hello')
    expect(json.data.source).toContain('Hello')
  })

  it('creates a new function', async () => {
    const res = await fetch(baseUrl + '/api/functions/v1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authToken },
      body: JSON.stringify({
        name: 'test-new',
        source: 'export default async function handler(req, ctx) { return { ok: true } }',
      }),
    })
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.message).toContain('created')
  })

  it('deletes a function', async () => {
    // Create first
    await fetch(baseUrl + '/api/functions/v1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authToken },
      body: JSON.stringify({
        name: 'to-delete',
        source: 'export default async () => ({})',
      }),
    })
    // Delete
    const res = await fetch(baseUrl + '/api/functions/v1/to-delete', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + authToken },
    })
    expect(res.status).toBe(200)
  })
})
