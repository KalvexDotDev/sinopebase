// @new-code-test positive src/plugins/posthog/plugin.ts
// @new-code-test negative src/plugins/posthog/plugin.ts
// @new-code-test positive src/core/app.ts
// @new-code-test negative src/core/app.ts
// @new-code-test positive src/index.ts
// @new-code-test negative src/index.ts
import { describe, expect, it, mock } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Elysia } from 'elysia'
import { Sinopebase } from '../../src/index'
import { PosthogPlugin, posthogOptionsFromEnv } from '../../src/plugins/posthog/plugin'
import { reserveLoopbackPort } from '../harness'

const options = { host: 'https://analytics.internal', token: 'synthetic-token' }
function setup() {
  const send = mock(async () => Response.json({ status: 1 }))
  const plugin = new PosthogPlugin(options, send as unknown as typeof fetch)
  const app = new Elysia()
    .use(plugin.register(new Elysia({ name: 'posthog-observability' })))
    .get('/records/:id', () => ({ private: 'evidence-secret' }))
    .get('/failure', () => {
      throw new Error('sensitive-error-message')
    })
  return { send, plugin, app }
}
describe('PostHog operational plugin', () => {
  it('defaults off and rejects cloud/cleartext/credentialed endpoints', () => {
    expect(posthogOptionsFromEnv({})).toBeUndefined()
    for (const host of [
      'https://eu.i.posthog.com',
      'http://private.internal',
      'https://user:pass@private.internal',
    ]) {
      expect(() =>
        posthogOptionsFromEnv({
          POSTHOG_ENABLED: 'true',
          POSTHOG_HOST: host,
          POSTHOG_API_KEY: 'test',
        }),
      ).toThrow()
    }
  })
  it('does not send telemetry when disabled', async () => {
    const send = mock(async () => Response.json({ status: 1 }))
    const plugin = new PosthogPlugin(undefined, send as unknown as typeof fetch)
    const app = plugin.register(new Elysia()).get('/records/:id', () => 'ok')
    expect((await app.handle(new Request('http://localhost/records/private-id'))).status).toBe(200)
    await plugin.shutdown()
    expect(send).not.toHaveBeenCalled()
  })
  it('uses template routes and excludes secrets while preserving the HTTP response', async () => {
    const { plugin, app, send } = setup()
    const response = await app.handle(
      new Request('http://localhost/records/customer-secret?token=query-secret', {
        headers: { authorization: 'Bearer header-secret', cookie: 'session=cookie-secret' },
      }),
    )
    expect(await response.json()).toEqual({ private: 'evidence-secret' })
    await plugin.shutdown()
    expect(send).toHaveBeenCalledTimes(1)
    const [host, init] = send.mock.calls[0] as unknown as [string, RequestInit]
    expect(host).toBe('https://analytics.internal/batch/')
    expect(init.redirect).toBe('error')
    const payload = String(init.body)
    for (const secret of [
      'customer-secret',
      'query-secret',
      'header-secret',
      'cookie-secret',
      'evidence-secret',
    ]) {
      expect(payload).not.toContain(secret)
    }
    expect(JSON.parse(payload).batch[0].properties).toMatchObject({
      route: '/records/:id',
      status: 200,
      method: 'GET',
    })
  })
  it('observes failures without collecting raw exception messages', async () => {
    const { plugin, app, send } = setup()
    expect((await app.handle(new Request('http://localhost/failure'))).status).toBe(500)
    await plugin.shutdown()
    const [, init] = send.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(init.body)).not.toContain('sensitive-error-message')
    expect(JSON.parse(String(init.body)).batch[0].properties.status).toBe(500)
  })
  it('does not fail requests or shutdown when telemetry delivery fails', async () => {
    const send = mock(async () => {
      throw new Error('private-host-error')
    })
    const plugin = new PosthogPlugin(options, send as unknown as typeof fetch)
    const app = plugin.register(new Elysia()).get('/ok', () => 'ok')
    expect((await app.handle(new Request('http://localhost/ok'))).status).toBe(200)
    await plugin.shutdown()
    expect(plugin.droppedEvents).toBe(1)
  })
  it('bounds memory when delivery cannot keep up', async () => {
    const { plugin, app, send } = setup()
    for (let i = 0; i < 1003; i++) await app.handle(new Request('http://localhost/records/example'))
    await plugin.shutdown()
    expect(plugin.droppedEvents).toBe(3)
    const [, init] = send.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body)).batch).toHaveLength(1000)
  })
})

it('reports server failures to error tracking without exception content or identity', async () => {
  const { plugin, app, send } = setup()
  await app.handle(new Request('http://localhost/failure?secret=private'))
  await plugin.shutdown()
  const [, init] = send.mock.calls[0] as unknown as [string, RequestInit]
  const payload = JSON.parse(String(init.body))
  const exception = payload.batch.find((event: { event: string }) => event.event === '$exception')
  expect(exception?.properties).toMatchObject({
    route: '/failure',
    status: 500,
    $process_person_profile: false,
    $ip: null,
    $exception_list: [
      {
        type: 'Error',
        value: 'Unexpected backend error (details withheld)',
        mechanism: { handled: false, synthetic: true },
      },
    ],
    $exception_fingerprint: JSON.stringify(['sinopebase', '/failure', 'GET', 500]),
  })
  expect(String(init.body)).not.toContain('private')
  expect(String(init.body)).not.toContain('sensitive-error-message')
})

it('rejects malformed URLs without exposing their value in errors', () => {
  for (const configure of [
    () =>
      posthogOptionsFromEnv({
        POSTHOG_ENABLED: 'true',
        POSTHOG_HOST: 'https://secret-value@',
        POSTHOG_API_KEY: 'test',
      }),
    () => new PosthogPlugin({ host: 'https://secret-value@', token: 'test' }),
  ]) {
    let failure: unknown
    try {
      configure()
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect(String(failure)).not.toContain('secret-value')
    expect(JSON.stringify(failure)).not.toContain('secret-value')
  }
})

it('does not classify client rejections as unexpected errors', async () => {
  const send = mock(async () => Response.json({ status: 1 }))
  const plugin = new PosthogPlugin(options, send as unknown as typeof fetch)
  const app = plugin
    .register(new Elysia())
    .get('/denied', () => new Response(null, { status: 403 }))
  expect((await app.handle(new Request('http://localhost/denied'))).status).toBe(403)
  await plugin.shutdown()
  const [, init] = send.mock.calls[0] as unknown as [string, RequestInit]
  const payload = JSON.parse(String(init.body))
  expect(payload.batch).toHaveLength(1)
  expect(payload.batch[0]).toMatchObject({
    event: 'sinopebase_request_completed',
    properties: { status: 403 },
  })
})

it('bounds synthetic error events together with request observations', async () => {
  const { plugin, app, send } = setup()
  for (let i = 0; i < 501; i++) await app.handle(new Request('http://localhost/failure'))
  await plugin.shutdown()
  const [, init] = send.mock.calls[0] as unknown as [string, RequestInit]
  const payload = JSON.parse(String(init.body))
  expect(payload.batch).toHaveLength(1000)
  expect(
    payload.batch.filter((event: { event: string }) => event.event === '$exception'),
  ).toHaveLength(500)
  expect(plugin.droppedEvents).toBeGreaterThan(0)
})

it('measures request duration when registered as a reusable Elysia plugin', async () => {
  const send = mock(async () => Response.json({ status: 1 }))
  const plugin = new PosthogPlugin(options, send as unknown as typeof fetch)
  const app = new Elysia()
    .use(plugin.register(new Elysia({ name: 'posthog-timing' })))
    .get('/slow', async () => {
      await Bun.sleep(20)
      return 'ok'
    })
  await app.handle(new Request('http://localhost/slow'))
  await plugin.shutdown()
  const [, init] = send.mock.calls[0] as unknown as [string, RequestInit]
  expect(JSON.parse(String(init.body)).batch[0].properties.duration_ms).toBeGreaterThanOrEqual(10)
})

for (const enabled of [false, true]) {
  it(`wires server lifecycle telemetry with enabled=${enabled}`, async () => {
    const keys = [
      'POSTHOG_ENABLED',
      'POSTHOG_HOST',
      'POSTHOG_API_KEY',
      'POSTGRES_URL',
      'RUSTFS_ENDPOINT',
      'RUSTFS_ACCESS_KEY',
      'RUSTFS_SECRET_KEY',
    ] as const
    const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
    for (const key of keys) process.env[key] = ''
    process.env.POSTHOG_ENABLED = String(enabled)
    process.env.POSTHOG_HOST = options.host
    process.env.POSTHOG_API_KEY = options.token
    const dataDir = await mkdtemp(join(tmpdir(), 'sinopebase-posthog-59-'))
    const reservation = await reserveLoopbackPort()
    const originalFetch = globalThis.fetch
    const sends: string[] = []
    globalThis.fetch = Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        if (String(input) === `${options.host}/batch/`) {
          sends.push(String(init?.body))
          return Response.json({ status: 1 })
        }
        return originalFetch(input, init)
      },
      { preconnect: originalFetch.preconnect },
    )
    const app = new Sinopebase({
      port: reservation.port,
      host: '127.0.0.1',
      mode: 'development',
      dataDir,
      postgresUrl: '',
      minioEndpoint: '',
      minioAccessKey: '',
      minioSecretKey: '',
    })
    try {
      await reservation.release()
      await app.start()
      const response = await originalFetch(
        `${reservation.origin}/api/health?secret=must-not-export`,
      )
      expect(response.status).toBe(200)
      await app.stop()
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(sends.length).toBe(enabled ? 1 : 0)
      expect(sends.join('')).not.toContain('must-not-export')
      if (enabled)
        expect(
          JSON.parse(sends[0] ?? 'null').batch.some(
            (event: { properties: { route: string } }) => event.properties.route === '/api/health',
          ),
        ).toBe(true)
    } finally {
      await app.stop()
      globalThis.fetch = originalFetch
      for (const key of keys) {
        if (prior[key] === undefined) delete process.env[key]
        else process.env[key] = prior[key]
      }
      await reservation.release()
      await rm(dataDir, { recursive: true, force: true })
    }
  })
}
