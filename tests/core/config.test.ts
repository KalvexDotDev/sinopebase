import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { ProductionConfig, detectMode } from '../../src/core/config'

describe('ProductionConfig schema', () => {
  it('parses valid config with all required fields', () => {
    const result = ProductionConfig.safeParse({
      postgresUrl: 'https://example.com/db',
      jwtSecret: 'a'.repeat(32),
      serviceRoleKey: 'b'.repeat(32),
      anonKey: 'c'.repeat(32),
    })
    expect(result.success).toBe(true)
  })

  it('applies defaults for optional fields', () => {
    const result = ProductionConfig.parse({
      postgresUrl: 'https://example.com/db',
      jwtSecret: 'a'.repeat(32),
      serviceRoleKey: 'b'.repeat(32),
      anonKey: 'c'.repeat(32),
    })
    expect(result.port).toBe(8090)
    expect(result.host).toBe('0.0.0.0')
    expect(result.dataDir).toBe('./pb_data')
    expect(result.mastraRequireAuth).toBe(true)
    expect(result.oauthProviders).toEqual([])
    expect(result.extraOrigins).toEqual([])
    expect(result.trustedProxies).toEqual([])
  })

  it('rejects short jwtSecret (< 32 chars)', () => {
    const result = ProductionConfig.safeParse({
      postgresUrl: 'https://example.com/db',
      jwtSecret: 'short',
      serviceRoleKey: 'b'.repeat(32),
      anonKey: 'c'.repeat(32),
    })
    expect(result.success).toBe(false)
  })

  it('rejects short serviceRoleKey (< 32 chars)', () => {
    const result = ProductionConfig.safeParse({
      postgresUrl: 'https://example.com/db',
      jwtSecret: 'a'.repeat(32),
      serviceRoleKey: 'short',
      anonKey: 'c'.repeat(32),
    })
    expect(result.success).toBe(false)
  })

  it('rejects short anonKey (< 32 chars)', () => {
    const result = ProductionConfig.safeParse({
      postgresUrl: 'https://example.com/db',
      jwtSecret: 'a'.repeat(32),
      serviceRoleKey: 'b'.repeat(32),
      anonKey: 'short',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid port (too low)', () => {
    const result = ProductionConfig.safeParse({
      postgresUrl: 'https://example.com/db',
      jwtSecret: 'a'.repeat(32),
      serviceRoleKey: 'b'.repeat(32),
      anonKey: 'c'.repeat(32),
      port: 0,
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid port (too high)', () => {
    const result = ProductionConfig.safeParse({
      postgresUrl: 'https://example.com/db',
      jwtSecret: 'a'.repeat(32),
      serviceRoleKey: 'b'.repeat(32),
      anonKey: 'c'.repeat(32),
      port: 65536,
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-integer port', () => {
    const result = ProductionConfig.safeParse({
      postgresUrl: 'https://example.com/db',
      jwtSecret: 'a'.repeat(32),
      serviceRoleKey: 'b'.repeat(32),
      anonKey: 'c'.repeat(32),
      port: 80.5,
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-url postgresUrl', () => {
    const result = ProductionConfig.safeParse({
      postgresUrl: 'not-a-url',
      jwtSecret: 'a'.repeat(32),
      serviceRoleKey: 'b'.repeat(32),
      anonKey: 'c'.repeat(32),
    })
    expect(result.success).toBe(false)
  })

  it('accepts tls config', () => {
    const result = ProductionConfig.safeParse({
      postgresUrl: 'https://example.com/db',
      jwtSecret: 'a'.repeat(32),
      serviceRoleKey: 'b'.repeat(32),
      anonKey: 'c'.repeat(32),
      tls: { cert: '/path/to/cert.pem', key: '/path/to/key.pem' },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.tls!.cert).toBe('/path/to/cert.pem')
      expect(result.data.tls!.key).toBe('/path/to/key.pem')
    }
  })

  it('accepts optional fields override', () => {
    const result = ProductionConfig.parse({
      postgresUrl: 'https://example.com/db',
      jwtSecret: 'a'.repeat(32),
      serviceRoleKey: 'b'.repeat(32),
      anonKey: 'c'.repeat(32),
      port: 443,
      host: '127.0.0.1',
      s3Endpoint: 'https://s3.example.com',
      openaiApiKey: 'sk-test',
      mastraRequireAuth: false,
      dataDir: '/var/data',
    })
    expect(result.port).toBe(443)
    expect(result.host).toBe('127.0.0.1')
    expect(result.s3Endpoint).toBe('https://s3.example.com')
    expect(result.openaiApiKey).toBe('sk-test')
    expect(result.mastraRequireAuth).toBe(false)
    expect(result.dataDir).toBe('/var/data')
  })

  it('accepts oauthProviders', () => {
    const result = ProductionConfig.parse({
      postgresUrl: 'https://example.com/db',
      jwtSecret: 'a'.repeat(32),
      serviceRoleKey: 'b'.repeat(32),
      anonKey: 'c'.repeat(32),
      oauthProviders: [
        {
          providerId: 'google',
          clientId: 'google-id',
          clientSecret: 'google-secret',
          tenantId: 'google-tenant',
          issuer: 'https://accounts.google.com',
        },
      ],
    })
    expect(result.oauthProviders).toHaveLength(1)
    expect(result.oauthProviders[0]!.providerId).toBe('google')
  })

  it('accepts trustedProxies', () => {
    const result = ProductionConfig.parse({
      postgresUrl: 'https://example.com/db',
      jwtSecret: 'a'.repeat(32),
      serviceRoleKey: 'b'.repeat(32),
      anonKey: 'c'.repeat(32),
      trustedProxies: ['10.0.0.1', '172.16.0.0/12'],
    })
    expect(result.trustedProxies).toEqual(['10.0.0.1', '172.16.0.0/12'])
  })
})

// ---------------------------------------------------------------------------
// detectMode — snapshot process.env at file level to avoid racing
// with other test files that run in parallel.
// ---------------------------------------------------------------------------

describe('detectMode', () => {
  // Snapshot process.env at the FILE level (beforeAll/afterAll) so that
  // parallel test files never see a polluted NODE_ENV mid-suite.
  const saved = new Map<string, string | undefined>()

  beforeAll(() => {
    for (const key of ['NODE_ENV', 'SINOPEBASE_PRODUCTION']) {
      saved.set(key, process.env[key])
    }
  })

  afterAll(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('returns development by default', () => {
    delete process.env['NODE_ENV']
    delete process.env['SINOPEBASE_PRODUCTION']
    expect(detectMode()).toBe('development')
  })

  it('returns production when NODE_ENV=production', () => {
    delete process.env['SINOPEBASE_PRODUCTION']
    process.env['NODE_ENV'] = 'production'
    expect(detectMode()).toBe('production')
  })

  it('returns production when SINOPEBASE_PRODUCTION=true', () => {
    delete process.env['NODE_ENV']
    process.env['SINOPEBASE_PRODUCTION'] = 'true'
    expect(detectMode()).toBe('production')
  })

  it('prefers NODE_ENV over SINOPEBASE_PRODUCTION', () => {
    process.env['NODE_ENV'] = 'production'
    process.env['SINOPEBASE_PRODUCTION'] = 'false'
    expect(detectMode()).toBe('production')
  })
})
