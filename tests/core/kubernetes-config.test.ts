import { describe, expect, test } from 'bun:test'
import { getClientIP } from '~/apis/middlewares_rate_limit'
import { parseS3Endpoint, Sinopebase } from '~/core/app'
import { deploymentConfigFromEnv } from '../../cmd/deployment-config'

// @new-code-test positive src/core/app.ts
// @new-code-test negative src/core/app.ts

describe('shared deployment configuration', () => {
  test('Railway defaults leave multi-replica features disabled', () => {
    expect(deploymentConfigFromEnv({})).toEqual({
      enablePgNotify: false,
      multiReplica: false,
      externalRateLimit: false,
      trustedProxies: undefined,
    })
  })

  test('Kubernetes env enables shared features and trims trusted proxies', () => {
    expect(
      deploymentConfigFromEnv({
        SINOPEBASE_PG_NOTIFY: 'true',
        SINOPEBASE_MULTI_REPLICA: 'true',
        SINOPEBASE_EXTERNAL_RATE_LIMIT: 'true',
        TRUSTED_PROXIES: '10.0.0.0/8, 192.0.2.7, ',
      }),
    ).toEqual({
      enablePgNotify: true,
      multiReplica: true,
      externalRateLimit: true,
      trustedProxies: ['10.0.0.0/8', '192.0.2.7'],
    })
  })

  test('explicit false does not enable deployment features', () => {
    expect(
      deploymentConfigFromEnv({
        SINOPEBASE_PG_NOTIFY: 'false',
        SINOPEBASE_MULTI_REPLICA: 'false',
        SINOPEBASE_EXTERNAL_RATE_LIMIT: 'false',
      }),
    ).toEqual({
      enablePgNotify: false,
      multiReplica: false,
      externalRateLimit: false,
      trustedProxies: undefined,
    })
  })

  test('scheme URLs use standard ports and bare hosts keep RustFS default', () => {
    expect(parseS3Endpoint('https://objects.example.test')).toEqual({
      host: 'objects.example.test',
      port: 443,
      useSSL: true,
    })
    expect(parseS3Endpoint('http://objects.example.test')).toEqual({
      host: 'objects.example.test',
      port: 80,
      useSSL: false,
    })
    expect(parseS3Endpoint('rustfs')).toEqual({ host: 'rustfs', port: 9000, useSSL: false })
    expect(parseS3Endpoint('https://objects.example.test:9443')).toEqual({
      host: 'objects.example.test',
      port: 9443,
      useSSL: true,
    })
    expect(() => parseS3Endpoint('https://objects.example.test/bucket')).toThrow()
  })

  test('explicit trusted proxies and notifications are visible in config', () => {
    const app = new Sinopebase({
      enablePgNotify: true,
      trustedProxies: ['10.0.0.0/8'],
    })
    expect(app.buildValidatedConfig().enablePgNotify).toBe(true)
    expect(app.buildValidatedConfig().trustedProxies).toEqual(['10.0.0.0/8'])
    const forwarded = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '198.51.100.5, 203.0.113.10' },
    })
    expect(getClientIP(forwarded, ['atlas-ingress'])).toBe('203.0.113.10')
  })

  test('multi-replica mode rejects missing shared ingress limit', async () => {
    const app = new Sinopebase({ multiReplica: true, mode: 'development' })
    await expect(app.start()).rejects.toThrow('shared ingress rate limit')
  })

  test('multi-replica mode rejects local maintenance operations', async () => {
    const app = new Sinopebase({ multiReplica: true, mode: 'development' })
    await expect(app.createBackup('manual')).rejects.toThrow('unavailable in multi-replica mode')
    await expect(app.restoreBackup('manual')).rejects.toThrow('unavailable in multi-replica mode')
    expect(() => app.scheduleBackup('* * * * *')).toThrow('single designated worker')
    await expect(app.runAllMigrations()).resolves.toBeUndefined()
  })
})
