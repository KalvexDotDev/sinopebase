import { describe, it, expect } from 'bun:test'
import {
  parseSemver,
  compareSemver,
  isGreaterThan,
  isLessThan,
  isEqual,
} from './release.ts'

describe('release version parser', () => {
  describe('parseSemver', () => {
    it('parses standard semver', () => {
      const v = parseSemver('1.2.3')
      expect(v).not.toBeNull()
      expect(v!.major).toBe(1)
      expect(v!.minor).toBe(2)
      expect(v!.patch).toBe(3)
      expect(v!.preRelease).toBe('')
    })

    it('parses with v prefix', () => {
      const v = parseSemver('v0.23.0')
      expect(v).not.toBeNull()
      expect(v!.major).toBe(0)
      expect(v!.minor).toBe(23)
      expect(v!.patch).toBe(0)
    })

    it('parses with capital V prefix', () => {
      const v = parseSemver('V1.0.0')
      expect(v).not.toBeNull()
      expect(v!.major).toBe(1)
    })

    it('parses pre-release versions', () => {
      const v = parseSemver('1.0.0-beta')
      expect(v).not.toBeNull()
      expect(v!.preRelease).toBe('beta')
    })

    it('parses pre-release with numbers', () => {
      const v = parseSemver('1.0.0-beta.1')
      expect(v).not.toBeNull()
      expect(v!.preRelease).toBe('beta.1')
    })

    it('returns null for invalid versions', () => {
      expect(parseSemver('abc')).toBeNull()
      expect(parseSemver('')).toBeNull()
      expect(parseSemver('1.2.3.4')).toBeNull()
    })

    it('handles two-part versions as major.minor with patch=0', () => {
      const v = parseSemver('1.2')
      expect(v).not.toBeNull()
      expect(v!.major).toBe(1)
      expect(v!.minor).toBe(2)
      expect(v!.patch).toBe(0)
    })
  })

  describe('compareSemver', () => {
    it('returns 0 for equal versions', () => {
      const a = parseSemver('1.2.3')!
      const b = parseSemver('1.2.3')!
      expect(compareSemver(a, b)).toBe(0)
    })

    it('returns positive when a is greater', () => {
      const a = parseSemver('2.0.0')!
      const b = parseSemver('1.9.9')!
      expect(compareSemver(a, b)).toBeGreaterThan(0)
    })

    it('returns negative when a is less', () => {
      const a = parseSemver('1.0.0')!
      const b = parseSemver('1.0.1')!
      expect(compareSemver(a, b)).toBeLessThan(0)
    })

    it('considers pre-release less than release', () => {
      const a = parseSemver('1.0.0')!
      const b = parseSemver('1.0.0-alpha')!
      expect(compareSemver(a, b)).toBeGreaterThan(0)
      expect(compareSemver(b, a)).toBeLessThan(0)
    })
  })

  describe('isGreaterThan', () => {
    it('returns true when a > b', () => {
      expect(isGreaterThan('2.0.0', '1.0.0')).toBe(true)
    })

    it('returns false when a < b', () => {
      expect(isGreaterThan('1.0.0', '2.0.0')).toBe(false)
    })

    it('returns false when equal', () => {
      expect(isGreaterThan('1.0.0', '1.0.0')).toBe(false)
    })
  })

  describe('isLessThan', () => {
    it('returns true when a < b', () => {
      expect(isLessThan('1.0.0', '2.0.0')).toBe(true)
    })

    it('returns false when a > b', () => {
      expect(isLessThan('2.0.0', '1.0.0')).toBe(false)
    })
  })

  describe('isEqual', () => {
    it('returns true for equal versions', () => {
      expect(isEqual('1.0.0', '1.0.0')).toBe(true)
    })

    it('returns false for different versions', () => {
      expect(isEqual('1.0.0', '1.0.1')).toBe(false)
    })
  })
})
