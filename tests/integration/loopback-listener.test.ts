import { expect, it } from 'bun:test'
import { requirePostgres } from '../harness'
import { startLoopbackApp } from '../harness/server'

it('keeps concurrent test listeners on distinct OS-bound loopback ports', async () => {
  const config = {
    postgresUrl: requirePostgres(),
    jwtSecret: 'loopback-test-jwt-secret-min-32-chars!',
    serviceRoleKey: 'loopback-test-service-key-min-32-chars!',
    anonKey: 'loopback-test-anon-key-min-32-chars!',
  }
  const first = await startLoopbackApp(config)
  try {
    const second = await startLoopbackApp(config)
    try {
      expect(first.origin).toMatch(/^http:\/\/127\.0\.0\.1:[1-9]\d*$/)
      expect(second.origin).toMatch(/^http:\/\/127\.0\.0\.1:[1-9]\d*$/)
      expect(first.origin).not.toBe(second.origin)
      for (const origin of [first.origin, second.origin]) {
        const response = await fetch(`${origin}/api/ready`)
        expect(response.status).toBe(200)
      }
    } finally {
      await second.app.stop()
    }
  } finally {
    await first.app.stop()
  }
})
