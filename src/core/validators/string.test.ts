import { describe, it, expect } from 'bun:test'
import { IsRegex, IPOrSubnet } from '~/core/validators/string.ts'

describe('IsRegex', () => {
  it('returns null for empty string', () => {
    expect(IsRegex('')).toBeNull()
  })

  it('returns null for valid regex', () => {
    expect(IsRegex('^\\w+$')).toBeNull()
    expect(IsRegex('[a-z]+')).toBeNull()
    expect(IsRegex('\\d{3}-\\d{4}')).toBeNull()
  })

  it('returns error for invalid regex', () => {
    const err = IsRegex('[invalid')
    expect(err).not.toBeNull()
    expect(err!.code).toBe('validation_invalid_regex')
  })

  it('returns error for non-string input', () => {
    expect(IsRegex(123)).not.toBeNull()
    expect(IsRegex(null)).not.toBeNull()
    expect(IsRegex(undefined)).not.toBeNull()
  })
})

describe('IPOrSubnet', () => {
  it('returns null for empty string', () => {
    expect(IPOrSubnet('')).toBeNull()
  })

  it('returns null for valid IPv4 addresses', () => {
    expect(IPOrSubnet('192.168.1.1')).toBeNull()
    expect(IPOrSubnet('10.0.0.1')).toBeNull()
    expect(IPOrSubnet('255.255.255.255')).toBeNull()
    expect(IPOrSubnet('0.0.0.0')).toBeNull()
  })

  it('returns null for valid IPv4 CIDR subnets', () => {
    expect(IPOrSubnet('192.168.1.0/24')).toBeNull()
    expect(IPOrSubnet('10.0.0.0/8')).toBeNull()
  })

  it('returns null for valid IPv6 addresses', () => {
    expect(IPOrSubnet('::1')).toBeNull()
    expect(IPOrSubnet('fe80::1')).toBeNull()
  })

  it('returns error for invalid IP addresses', () => {
    expect(IPOrSubnet('999.999.999.999')).not.toBeNull()
    expect(IPOrSubnet('256.0.0.1')).not.toBeNull()
  })

  it('returns error for invalid CIDR', () => {
    expect(IPOrSubnet('192.168.1.0/33')).not.toBeNull()
  })

  it('returns error for non-string input', () => {
    expect(IPOrSubnet(123)).not.toBeNull()
    expect(IPOrSubnet(null)).not.toBeNull()
  })
})
