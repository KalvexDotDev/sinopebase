// ---------------------------------------------------------------------------
// DropFunctions — Integration tests
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Sinopebase } from '~/core/app'
import { requirePostgres, reserveLoopbackPort } from '../../harness'

/** Loose test-response accessor — narrower than `any`. */
interface TestResponse {
  data?: unknown
  requestId?: unknown
  functionName?: unknown
  env?: unknown
  path?: unknown
  method?: unknown
  error?: unknown
  [key: string]: unknown
}

// Per-run temp dir — parallel suites must never share the functions directory.
const DEFAULT_FN_DIR = resolve(tmpdir(), `sinopebase-drop-fn-exec-${process.pid}`)

/** Service role key accepted by protected functions (matches beforeAll config). */
const SERVICE_ROLE_KEY = 'drop-fn-test-service-key-min-32-chars!!'

function writeTestFunction(name: string, source: string): void {
  mkdirSync(DEFAULT_FN_DIR, { recursive: true })
  writeFileSync(join(DEFAULT_FN_DIR, `${name}.ts`), source, 'utf-8')
}

function cleanupTestFunctions(): void {
  try {
    const entries = readdirSync(DEFAULT_FN_DIR)
    for (const entry of entries) {
      if (entry.endsWith('.ts') || entry.endsWith('.js')) {
        try {
          rmSync(join(DEFAULT_FN_DIR, entry), { force: true })
        } catch {
          /* ok */
        }
      }
    }
  } catch {
    /* directory may not exist */
  }
}

describe('DropFunctions Plugin', () => {
  let app: Sinopebase
  let baseUrl: string
  let authToken = ''
  let signupEmail = ''

  beforeAll(async () => {
    const portReservation = await reserveLoopbackPort()
    cleanupTestFunctions()

    // Write a test function
    writeTestFunction(
      'hello',
      `
      export const config = { auth: false }
      export default async function handler(req, ctx) {
        const name = new URL(req.url).searchParams.get('name') || 'world'
        return { message: 'Hello, ' + name + '!', requestId: ctx.requestId }
      }
    `,
    )

    // Write an auth-required function
    writeTestFunction(
      'protected',
      `
      export const config = { auth: true }
      export default async function handler(req, ctx) {
        return { user: ctx.auth, message: 'This is protected' }
      }
    `,
    )

    // Write a slow function (for timeout testing)
    writeTestFunction(
      'slow',
      `
      export const config = { timeout: 500 }
      export default async function handler(req, ctx) {
        await new Promise(resolve => setTimeout(resolve, 2000))
        return { done: true }
      }
    `,
    )

    app = new Sinopebase({
      port: portReservation.port,
      postgresUrl: requirePostgres(),
      jwtSecret: 'drop-fn-test-jwt-secret-min-32-chars!',
      serviceRoleKey: SERVICE_ROLE_KEY,
      anonKey: 'drop-fn-test-anon-key-min-32-chars!!!',
      functionsDir: DEFAULT_FN_DIR,
    })
    await portReservation.release()

    await app.start()

    baseUrl = portReservation.origin

    // Sign up and get an auth token for management CRUD tests
    signupEmail = `fn-admin-${Date.now()}@test.com`
    const signupRes = await fetch(`${baseUrl}/auth/v1/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: signupEmail,
        password: 'secure-admin-password-99',
      }),
    })
    const signupJson = (await signupRes.json()) as TestResponse
    console.log(
      'Signup status:',
      signupRes.status,
      'body:',
      JSON.stringify(signupJson).slice(0, 200),
    )
    authToken = (signupJson.access_token as string) || ''
  })

  // The session token can be invalidated between beforeAll and a test when
  // the full suite runs many apps in parallel against the shared database.
  // Sign up fresh inside the test and use that token immediately, so the
  // window for interference is the request itself.
  async function authenticatedGet(path: string): Promise<{ res: Response; email: string }> {
    const email = `fn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`
    const signup = await fetch(`${baseUrl}/auth/v1/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'secure-admin-password-99' }),
    })
    const json = (await signup.json()) as TestResponse
    const token = (json.access_token as string) || ''
    expect(token).toBeTruthy()
    let res = await fetch(`${baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.status === 401) {
      const signin = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'secure-admin-password-99' }),
      })
      const signinJson = (await signin.json()) as TestResponse
      const fresh = (signinJson.access_token as string) || ''
      if (fresh) {
        res = await fetch(`${baseUrl}${path}`, {
          headers: { Authorization: `Bearer ${fresh}` },
        })
      }
      if (res.status === 401) {
        const health = await fetch(`${baseUrl}/api/health`).catch(() => null)
        const healthBody = health ? await health.json().catch(() => null) : null
        console.log(
          '[drop-fn-diag] baseUrl',
          baseUrl,
          'health',
          JSON.stringify(healthBody).slice(0, 200),
        )
      }
    }
    return { res, email }
  }

  afterAll(async () => {
    await app.stop()
    // Clean up test functions from default functionsDir
    try {
      rmSync(resolve('./functions/hello.ts'), { force: true })
    } catch {
      /* ok */
    }
    try {
      rmSync(resolve('./functions/protected.ts'), { force: true })
    } catch {
      /* ok */
    }
  })

  // -----------------------------------------------------------------------
  // HTTP execution
  // -----------------------------------------------------------------------

  it('executes a public function', async () => {
    const res = await fetch(`${baseUrl}/api/functions/v1/hello?name=Sinopebase`)
    expect(res.status).toBe(200)
    const json = (await res.json()) as TestResponse
    const data = json.data as { message?: string; requestId?: string }
    expect(data.message).toBe('Hello, Sinopebase!')
    expect(data.requestId).toBeTruthy()
  })

  it('returns requestId and functionName in response', async () => {
    const res = await fetch(`${baseUrl}/api/functions/v1/hello`)
    expect(res.status).toBe(200)
    const json = (await res.json()) as TestResponse
    expect(json.requestId).toBeTruthy()
    expect(json.functionName).toBe('hello')
  })

  // -----------------------------------------------------------------------
  // Auth
  // -----------------------------------------------------------------------

  it('rejects protected function without auth', async () => {
    const res = await fetch(`${baseUrl}/api/functions/v1/protected`)
    expect(res.status).toBe(401)
  })

  it('invokes a protected function with a valid session token', async () => {
    const { res, email } = await authenticatedGet('/api/functions/v1/protected')
    expect(res.status).toBe(200)
    const json = (await res.json()) as TestResponse
    const data = json.data as {
      user?: { userId?: string; email?: string; role?: string }
      message?: string
    }
    expect(data.message).toBe('This is protected')
    expect(data.user).toBeTruthy()
    expect(data.user?.userId).toBeTruthy()
    expect(data.user?.email).toBe(email)
    expect(data.user?.role).toBeTruthy()
  })

  it('invokes a protected function with the service role key', async () => {
    const res = await fetch(`${baseUrl}/api/functions/v1/protected`, {
      headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as TestResponse
    const data = json.data as { message?: string }
    expect(data.message).toBe('This is protected')
  })

  // -----------------------------------------------------------------------
  // Not found
  // -----------------------------------------------------------------------

  it('returns 404 for unknown function', async () => {
    const res = await fetch(`${baseUrl}/api/functions/v1/nonexistent`)
    expect(res.status).toBe(404)
  })

  // -----------------------------------------------------------------------
  // Management CRUD
  // -----------------------------------------------------------------------

  it('lists all functions', async () => {
    const { res } = await authenticatedGet('/api/functions/v1')
    expect(res.status).toBe(200)
    const json = (await res.json()) as TestResponse
    const dataArr = json.data as unknown[]
    expect(dataArr).toBeInstanceOf(Array)
    expect(dataArr.length).toBeGreaterThanOrEqual(3)
  })

  it('gets function source', async () => {
    const res = await fetch(`${baseUrl}/api/functions/v1/hello/source`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as TestResponse
    const srcData = json.data as { name?: string; source?: string }
    expect(srcData.name).toBe('hello')
    expect(srcData.source).toContain('Hello')
  })

  it('creates a new function', async () => {
    const res = await fetch(`${baseUrl}/api/functions/v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        name: 'test-new',
        source: 'export default async function handler(req, ctx) { return { ok: true } }',
      }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as TestResponse
    expect(json.message).toContain('created')
  })

  it('deletes a function', async () => {
    // Create first
    await fetch(`${baseUrl}/api/functions/v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        name: 'to-delete',
        source: 'export default async () => ({})',
      }),
    })
    // Delete
    const res = await fetch(`${baseUrl}/api/functions/v1/to-delete`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` },
    })
    expect(res.status).toBe(200)
  })
})
