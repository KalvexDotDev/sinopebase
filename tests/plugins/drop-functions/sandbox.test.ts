// ---------------------------------------------------------------------------
// DropFunctions — Sandbox isolation tests
// Tests for Worker-isolated function execution with timeout, error handling,
// environment isolation, and Response passthrough.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { Sinopebase } from '~/core/app'
import { DropFunctionsPlugin } from '~/plugins/drop-functions/plugin'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'

const TEST_FUNCTIONS_DIR = resolve(
  (import.meta as any).dir ?? new URL('.', import.meta.url).pathname ?? '.',
  '../../sandbox-test-functions',
)

function writeTestFunction(name: string, source: string): void {
  const dir = resolve(TEST_FUNCTIONS_DIR)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name + '.ts'), source, 'utf-8')
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
    cleanupTestFunctions()

    // Function that returns a plain object
    writeTestFunction('test-fn', `
      export const config = { auth: false }
      export default async function handler() {
        return { hello: 'world' }
      }
    `)

    // Slow function with a short timeout so the worker is killed
    writeTestFunction('slow-fn', `
      export const config = { auth: false, timeout: 500 }
      export default async function handler() {
        await new Promise(resolve => setTimeout(resolve, 2000))
        return { done: true }
      }
    `)

    // Function that throws an error
    writeTestFunction('error-fn', `
      export const config = { auth: false }
      export default async function handler() {
        throw new Error('boom')
      }
    `)

    // Function that tries to read process.env directly
    writeTestFunction('env-fn', `
      export const config = { auth: false }
      export default async function handler() {
        return { secret: process.env.JWT_SECRET }
      }
    `)

    // Function that returns a raw Response object
    writeTestFunction('resp-fn', `
      export const config = { auth: false }
      export default async function handler() {
        return new Response('custom', { status: 201 })
      }
    `)

    app = new Sinopebase({
      port: 8101,
      postgresUrl: process.env.TEST_POSTGRES_URL || '',
    })
    await app.start()

    plugin = new DropFunctionsPlugin({
      functionsDir: TEST_FUNCTIONS_DIR,
      defaultTimeout: 5000,
    })
    await plugin.register(
      app['server'] as any,
      (app as any).getAuth?.(),
    )

    baseUrl = 'http://127.0.0.1:8101'
  })

  afterAll(async () => {
    await app.stop()
    cleanupTestFunctions()
  })

  // -----------------------------------------------------------------------
  // Sandbox execution
  // -----------------------------------------------------------------------

  it('executes a function in the sandbox', async () => {
    const res = await fetch(baseUrl + '/api/functions/v1/test-fn', {
      method: 'POST',
    })
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.data).toEqual({ hello: 'world' })
    expect(json.requestId).toBeTruthy()
    expect(json.functionName).toBe('test-fn')
  })

  it('timeout kills the worker', async () => {
    const res = await fetch(baseUrl + '/api/functions/v1/slow-fn', {
      method: 'POST',
    })
    expect(res.status).toBe(504)
    const json = await res.json() as any
    expect(json.error).toContain('timed out')
  })

  it('worker errors propagate correctly', async () => {
    const res = await fetch(baseUrl + '/api/functions/v1/error-fn', {
      method: 'POST',
    })
    expect(res.status).toBe(500)
    const json = await res.json() as any
    expect(json.error).toContain('boom')
  })

  it('worker cannot access process.env', async () => {
    const res = await fetch(baseUrl + '/api/functions/v1/env-fn', {
      method: 'POST',
    })
    expect(res.status).toBe(200)
    const json = await res.json() as any
    // Bun worker created with env: {} — process.env.JWT_SECRET is undefined
    expect(json.data.secret).toBeUndefined()
  })

  it('Response objects pass through', async () => {
    const res = await fetch(baseUrl + '/api/functions/v1/resp-fn', {
      method: 'POST',
    })
    expect(res.status).toBe(201)
    const body = await res.text()
    expect(body).toBe('custom')
  })
})
