import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { reserveLoopbackPort } from '../harness'

const projectRoot = resolve(import.meta.dir, '../..')

let serverProcess: ReturnType<typeof Bun.spawn> | undefined
let serverStderr = Promise.resolve('')
let origin = ''
let dataDir = ''

async function waitUntilReady(): Promise<void> {
  const deadline = Date.now() + 10_000
  let lastError: unknown

  while (Date.now() < deadline) {
    if (serverProcess?.exitCode !== null) {
      throw new Error(`serve command exited before becoming ready:\n${await serverStderr}`)
    }

    try {
      const response = await fetch(`${origin}/api/health`, {
        signal: AbortSignal.timeout(500),
      })
      if (response.ok) return
      lastError = new Error(`healthcheck returned ${response.status}`)
    } catch (error) {
      lastError = error
    }

    await Bun.sleep(25)
  }

  throw new Error(`serve command did not become ready: ${String(lastError)}`)
}

async function preflight(requestOrigin?: string): Promise<Response> {
  const headers = new Headers({
    'access-control-request-method': 'POST',
    'access-control-request-headers': 'authorization, content-type',
  })
  if (requestOrigin) headers.set('origin', requestOrigin)

  return fetch(`${origin}/api/health`, {
    method: 'OPTIONS',
    headers,
  })
}

beforeAll(async () => {
  const reservation = await reserveLoopbackPort()
  origin = reservation.origin
  dataDir = await mkdtemp(resolve(tmpdir(), 'sinopebase-cors-'))
  await reservation.release()

  serverProcess = Bun.spawn([process.execPath, 'run', 'cmd/serve.ts'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(reservation.port),
      HOST: reservation.host,
      DATA_DIR: dataDir,
      POSTGRES_URL: '',
      S3_ENDPOINT: '',
      S3_ACCESS_KEY: '',
      S3_SECRET_KEY: '',
      RUSTFS_ENDPOINT: '',
      RUSTFS_ACCESS_KEY: '',
      RUSTFS_SECRET_KEY: '',
      SINOPEBASE_EXTRA_ORIGINS: ' https://app.example.com, ,https://admin.example.com ',
    },
    stdout: 'ignore',
    stderr: 'pipe',
  })
  if (serverProcess.stderr instanceof ReadableStream) {
    serverStderr = new Response(serverProcess.stderr).text()
  }

  await waitUntilReady()
})

afterAll(async () => {
  if (serverProcess?.exitCode === null) serverProcess.kill('SIGTERM')
  await serverProcess?.exited
  if (dataDir) await rm(dataDir, { recursive: true, force: true })
})

describe('CORS preflight requests', () => {
  it('allows origins configured by the serve command environment', async () => {
    const response = await preflight('https://app.example.com')

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://app.example.com')
    expect(response.headers.get('access-control-allow-credentials')).toBe('true')
    expect(response.headers.get('access-control-allow-methods')).toContain('POST')
    expect(response.headers.get('access-control-allow-headers')).toBe('authorization, content-type')
    expect(response.headers.get('vary')).toBe(
      'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
    )
    expect(await response.text()).toBe('')
  })

  it('returns an empty 204 without allow headers for a rejected origin', async () => {
    const response = await preflight('https://rejected.example.com')

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(response.headers.get('vary')).toBe('Origin')
    expect(await response.text()).toBe('')
  })

  it('returns an empty 204 when a preflight request has no origin', async () => {
    const response = await preflight()

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(response.headers.get('vary')).toBe('Origin')
    expect(await response.text()).toBe('')
  })
})
