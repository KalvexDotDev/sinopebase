/**
 * @new-code-test positive src/core/app.ts
 * @new-code-test negative src/core/app.ts
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { getClientIP } from '~/apis/middlewares_rate_limit'
import { Sinopebase } from '~/core/app'

const req = (xff: string) => new Request('http://x/', { headers: { 'x-forwarded-for': xff } })

describe('getClientIP behind a trusted proxy', () => {
  test('uses the rightmost hop so a spoofed leftmost IP is ignored', () => {
    expect(getClientIP(req('6.6.6.6, 203.0.113.9'), ['ingress'])).toBe('203.0.113.9')
  })
})

describe('TRUSTED_PROXIES env', () => {
  afterEach(() => {
    delete process.env.TRUSTED_PROXIES
  })

  test('populates config.trustedProxies without empty entries', () => {
    process.env.TRUSTED_PROXIES = 'traefik, , 10.0.0.0/8'
    const vc = new Sinopebase({ port: 0 }).buildValidatedConfig()
    expect(vc.trustedProxies).toEqual(['traefik', '10.0.0.0/8'])
  })
})
