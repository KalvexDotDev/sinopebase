/**
 * Unit tests for production config validation — isDevSecret and detectMode.
 *
 * Tests the preflight logic that rejects dev/placeholder secrets without
 * needing a full Sinopebase server start with PostgreSQL. The integration
 * equivalent (postgrest.test.ts beforeAll) requires CI env vars that Bun
 * workers may not inherit.
 */

import { describe, expect, it } from 'bun:test'
import { detectMode, isDevSecret } from '../../src/core/config'

describe('isDevSecret', () => {
  it('rejects the sinopebase-dev-* pattern', () => {
    expect(isDevSecret('sinopebase-dev-jwt-secret-min-32-chars!!')).toBe(true)
  })

  it('rejects test-* pattern', () => {
    expect(isDevSecret('test-service-role-key-32-chars!!')).toBe(true)
    expect(isDevSecret('test-anon-key-32-characters!!!')).toBe(true)
  })

  it('rejects exact "password"', () => {
    expect(isDevSecret('password')).toBe(true)
  })

  it('rejects exact "admin"', () => {
    expect(isDevSecret('admin')).toBe(true)
  })

  it('rejects exact "secret"', () => {
    expect(isDevSecret('secret')).toBe(true)
  })

  it('rejects "changeme" prefixed values', () => {
    expect(isDevSecret('changeme123')).toBe(true)
    expect(isDevSecret('changeme-please')).toBe(true)
  })

  it('accepts a 64-char hex string (typical production key)', () => {
    expect(isDevSecret('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2')).toBe(false)
  })

  it('accepts application-specific keys', () => {
    expect(isDevSecret('pgrest-anon-key-min-32-chars!!!!!')).toBe(false)
    expect(isDevSecret('authtest-service-key-min-32-chars!!!')).toBe(false)
    expect(isDevSecret('storagetest-service-key-min-32-chars!!!')).toBe(false)
  })

  it('accepts UUID-like keys', () => {
    expect(isDevSecret('550e8400-e29b-41d4-a716-446655440000')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(isDevSecret('TEST-SERVICE-KEY')).toBe(true)
    expect(isDevSecret('PASSWORD')).toBe(true)
    expect(isDevSecret('Secret')).toBe(true)
  })
})

describe('detectMode', () => {
  it('returns production when NODE_ENV=production', () => {
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      expect(detectMode()).toBe('production')
    } finally {
      process.env.NODE_ENV = prev
    }
  })

  it('returns production when SINOPEBASE_PRODUCTION=true', () => {
    const prev = process.env.SINOPEBASE_PRODUCTION
    process.env.SINOPEBASE_PRODUCTION = 'true'
    process.env.NODE_ENV = 'development'
    try {
      expect(detectMode()).toBe('production')
    } finally {
      process.env.SINOPEBASE_PRODUCTION = prev
    }
  })

  it('returns development by default', () => {
    const prevNode = process.env.NODE_ENV
    const prevProd = process.env.SINOPEBASE_PRODUCTION
    delete process.env.NODE_ENV
    process.env.SINOPEBASE_PRODUCTION = 'false'
    try {
      expect(detectMode()).toBe('development')
    } finally {
      process.env.NODE_ENV = prevNode
      process.env.SINOPEBASE_PRODUCTION = prevProd
    }
  })
})
