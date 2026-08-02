/**
 * Unit tests for securityHeaders() middleware.
 *
 * Verifies that the middleware sets expected HTTP security headers
 * on every response without needing a running TLS server.
 */

import { describe, expect, it } from 'bun:test'
import { securityHeaders } from '../../src/apis/middlewares'

describe('securityHeaders middleware', () => {
  it('sets strict-transport-security with max-age and includeSubDomains', () => {
    const headers: Record<string, string> = {}
    const ctx = { set: { headers } } as unknown as Parameters<ReturnType<typeof securityHeaders>>[0]
    securityHeaders()(ctx)
    expect(headers['strict-transport-security']).toContain('max-age=')
    expect(headers['strict-transport-security']).toContain('includeSubDomains')
  })

  it('sets x-content-type-options to nosniff', () => {
    const headers: Record<string, string> = {}
    const ctx = { set: { headers } } as unknown as Parameters<ReturnType<typeof securityHeaders>>[0]
    securityHeaders()(ctx)
    expect(headers['x-content-type-options']).toBe('nosniff')
  })

  it('sets x-frame-options to SAMEORIGIN', () => {
    const headers: Record<string, string> = {}
    const ctx = { set: { headers } } as unknown as Parameters<ReturnType<typeof securityHeaders>>[0]
    securityHeaders()(ctx)
    expect(headers['x-frame-options']).toBe('SAMEORIGIN')
  })

  it('sets referrer-policy', () => {
    const headers: Record<string, string> = {}
    const ctx = { set: { headers } } as unknown as Parameters<ReturnType<typeof securityHeaders>>[0]
    securityHeaders()(ctx)
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
  })

  it('sets x-xss-protection', () => {
    const headers: Record<string, string> = {}
    const ctx = { set: { headers } } as unknown as Parameters<ReturnType<typeof securityHeaders>>[0]
    securityHeaders()(ctx)
    expect(headers['x-xss-protection']).toBe('1; mode=block')
  })

  it('sets all five security headers at once', () => {
    const headers: Record<string, string> = {}
    const ctx = { set: { headers } } as unknown as Parameters<ReturnType<typeof securityHeaders>>[0]
    securityHeaders()(ctx)
    expect(Object.keys(headers).length).toBe(5)
  })
})
