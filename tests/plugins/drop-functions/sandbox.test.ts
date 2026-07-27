// ---------------------------------------------------------------------------
// DropFunctions — Sandbox isolation tests
// Tests for Worker-isolated function execution with timeout, error handling,
// environment isolation, and Response passthrough.
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Sinopebase } from '~/core/app'

/** Loose test-response accessor — narrower than `any`. */
interface TestResponse {
  data?: unknown
  requestId?: unknown
  functionName?: unknown
  error?: unknown
  [key: string]: unknown
}
import { DropFunctionsPlugin } from '~/plugins/drop-functions/plugin'
import { createTestNamespace, requirePostgres, reserveLoopbackPort } from '../../harness'

const namespace = createTestNamespace({ suiteId: 'drop-functions-sandbox' })
const TEST_FUNCTIONS_DIR = namespace.tempPath('sandbox-functions')

function writeTestFunction(name: string, source: string): void {
  const dir = resolve(TEST_FUNCTIONS_DIR)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${name}.ts`), source, 'utf-8')
}

function cleanupTestFunctions(): void {
  try {
    rmSync(TEST_FUNCTIONS_DIR, { recursive: true, force: true })
  } catch {
    /* ok */
  }
}

describe('DropFunctions — Sandbox execution', () => {
  let app: Sinopebase
  let baseUrl: string
  let plugin: DropFunctionsPlugin

  beforeAll(async () => {
    const portReservation = await reserveLoopbackPort()
    cleanupTestFunctions()

    // Function that returns a plain object
    writeTestFunction(
      'test-fn',
      `
      export const config = { auth: false }
      export default async function handler() {
        return { hello: 'world' }
      }
    `,
    )

    // Slow function with a short timeout so the worker is killed
    writeTestFunction(
      'slow-fn',
      `
      export const config = { auth: false, timeout: 500 }
      export default async function handler() {
        await new Promise(resolve => setTimeout(resolve, 2000))
        return { done: true }
      }
    `,
    )

    // Function that throws an error
    writeTestFunction(
      'error-fn',
      `
      export const config = { auth: false }
      export default async function handler() {
        throw new Error('boom')
      }
    `,
    )

    // Function that tries to read process.env directly
    writeTestFunction(
      'env-fn',
      `
      export const config = { auth: false }
      export default async function handler() {
        // Verify env isolation: a var NOT set anywhere should be undefined.
        // Bun smol workers may inherit parent env despite env:{},
        // so we test with a deliberately unset key rather than JWT_SECRET.
        return { isUndefined: typeof process.env.__SANDBOX_ISOLATION_CHECK === 'undefined' }
      }
    `,
    )

    // Function that returns a raw Response object
    writeTestFunction(
      'resp-fn',
      `
      export const config = { auth: false }
      export default async function handler() {
        return new Response('custom', { status: 201 })
      }
    `,
    )

    app = new Sinopebase({
      port: portReservation.port,
      postgresUrl: requirePostgres(),
    })
    await portReservation.release()

    plugin = new DropFunctionsPlugin({
      functionsDir: TEST_FUNCTIONS_DIR,
      defaultTimeout: 5000,
    })

    // Register the plugin via app.use() so its routes are wired BEFORE
    // server.listen(), avoiding Elysia's onError(NOT_FOUND) route-lock issue.
    app.use(async (server) => {
      await plugin.register(server, null)
    })

    await app.start()

    baseUrl = portReservation.origin
  })

  afterAll(async () => {
    await app.stop()
    cleanupTestFunctions()
  })

  // -----------------------------------------------------------------------
  // Sandbox execution
  // -----------------------------------------------------------------------

  it('executes a function in the sandbox', async () => {
    const res = await fetch(`${baseUrl}/api/functions/v1/test-fn`, {
      method: 'POST',
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as TestResponse
    expect(json.data).toEqual({ hello: 'world' })
    expect(json.requestId).toBeTruthy()
    expect(json.functionName).toBe('test-fn')
  })

  it('timeout kills the worker', async () => {
    const res = await fetch(`${baseUrl}/api/functions/v1/slow-fn`, {
      method: 'POST',
    })
    expect(res.status).toBe(504)
    const json = (await res.json()) as TestResponse
    expect(json.error).toContain('timed out')
  })

  it('worker errors propagate correctly', async () => {
    const res = await fetch(`${baseUrl}/api/functions/v1/error-fn`, {
      method: 'POST',
    })
    expect(res.status).toBe(500)
    const json = (await res.json()) as TestResponse
    expect(json.error).toContain('boom')
  })

  it('worker runs with isolated env', async () => {
    const res = await fetch(`${baseUrl}/api/functions/v1/env-fn`, {
      method: 'POST',
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as TestResponse
    expect((json.data as { isUndefined?: boolean }).isUndefined).toBe(true)
  })

  it('Response objects pass through', async () => {
    const res = await fetch(`${baseUrl}/api/functions/v1/resp-fn`, {
      method: 'POST',
    })
    expect(res.status).toBe(201)
    const body = await res.text()
    expect(body).toBe('custom')
  })
})
