// @new-code-test positive src/core/app.ts
// @new-code-test negative src/core/app.ts
import { expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Sinopebase } from '~/index'
import { requirePostgres, requireRustFS, reserveLoopbackPort } from '../harness'

// Real PostgreSQL, object storage, app socket and collector socket. The adapter
// changes only test destination resolution; every response comes from HTTP.
for (const enabled of [false, true]) {
  it(`delivers full-stack lifecycle telemetry only when enabled=${enabled}`, async () => {
    const postgresUrl = requirePostgres()
    const storage = requireRustFS()
    for (const endpoint of [postgresUrl, storage.endpoint]) {
      expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(endpoint).hostname)
    }
    const originalFetch = globalThis.fetch
    expect((await originalFetch(`${storage.endpoint}/health`)).ok).toBe(true)
    const keys = ['POSTHOG_ENABLED', 'POSTHOG_HOST', 'POSTHOG_API_KEY'] as const
    const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
    const dataDir = await mkdtemp(join(tmpdir(), 'sinopebase-posthog-acceptance-'))
    const reservation = await reserveLoopbackPort()
    const bodies: string[] = []
    const delivered = Promise.withResolvers<void>()
    const collector = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        if (new URL(request.url).pathname !== '/batch/' || request.method !== 'POST')
          return new Response('Unsupported collector request', { status: 400 })
        bodies.push(await request.text())
        delivered.resolve()
        return Response.json({ status: 1 })
      },
    })
    process.env.POSTHOG_ENABLED = String(enabled)
    process.env.POSTHOG_HOST = 'https://acceptance.internal'
    process.env.POSTHOG_API_KEY = 'synthetic-acceptance-token'
    globalThis.fetch = Object.assign(
      (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
        originalFetch(
          String(input) === 'https://acceptance.internal/batch/'
            ? `http://127.0.0.1:${collector.port}/batch/`
            : input,
          init,
        ),
      { preconnect: originalFetch.preconnect },
    )
    const app = new Sinopebase({
      host: '127.0.0.1',
      port: reservation.port,
      dataDir,
      postgresUrl,
      minioEndpoint: storage.endpoint,
      minioAccessKey: storage.accessKey,
      minioSecretKey: storage.secretKey,
    })
    let deliveryTimeout: ReturnType<typeof setTimeout> | undefined
    try {
      await reservation.release()
      await app.start()
      expect(app.getDatabase()).not.toBeNull()
      expect(
        (await originalFetch(`${reservation.origin}/api/health?secret=private-value`)).ok,
      ).toBe(true)
      await app.stop()
      if (enabled) {
        await Promise.race([
          delivered.promise,
          new Promise<never>((_, reject) => {
            deliveryTimeout = setTimeout(
              () => reject(new Error('collector received no batch')),
              6000,
            )
          }),
        ])
        expect(JSON.parse(bodies[0] ?? 'null').batch[0].properties.route).toBe('/api/health')
      } else await new Promise<void>((resolve) => setImmediate(resolve))
      expect(bodies.length).toBe(enabled ? 1 : 0)
      expect(bodies.join('')).not.toContain('private-value')
    } finally {
      clearTimeout(deliveryTimeout)
      await app.stop()
      collector.stop(true)
      globalThis.fetch = originalFetch
      for (const key of keys) {
        if (prior[key] === undefined) delete process.env[key]
        else process.env[key] = prior[key]
      }
      await reservation.release()
      await rm(dataDir, { recursive: true, force: true })
    }
  }, 30000)
}
