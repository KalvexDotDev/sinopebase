import { describe, it, expect, mock } from 'bun:test'
import { GhUpdatePlugin } from './ghupdate.ts'

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

function mockFetch(response: Record<string, unknown>) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = mock(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => response,
  })) as unknown as typeof globalThis.fetch

  return () => {
    globalThis.fetch = originalFetch
  }
}

function mockFetchError() {
  const originalFetch = globalThis.fetch
  globalThis.fetch = mock(async () => ({
    ok: false,
    status: 404,
    statusText: 'Not Found',
    json: async () => ({}),
  })) as unknown as typeof globalThis.fetch

  return () => {
    globalThis.fetch = originalFetch
  }
}

describe('GhUpdatePlugin', () => {
  describe('constructor', () => {
    it('stores current version', () => {
      const plugin = new GhUpdatePlugin({ currentVersion: '0.1.0' })
      expect(typeof plugin.checkForUpdate).toBe('function')
    })
  })

  describe('checkForUpdate', () => {
    it('returns the latest version when newer release exists', async () => {
      const restore = mockFetch({
        tag_name: 'v0.2.0',
        name: 'v0.2.0',
        prerelease: false,
        html_url: 'https://github.com/sinopebase/sinopebase/releases/v0.2.0',
        body: 'New release',
        published_at: '2024-01-01T00:00:00Z',
      })

      try {
        const plugin = new GhUpdatePlugin({ currentVersion: '0.1.0' })
        const latest = await plugin.checkForUpdate()
        expect(latest).toBe('v0.2.0')
      } finally {
        restore()
      }
    })

    it('returns null when API request fails', async () => {
      const restore = mockFetchError()

      try {
        const plugin = new GhUpdatePlugin({ currentVersion: '0.1.0' })
        const latest = await plugin.checkForUpdate()
        expect(latest).toBeNull()
      } finally {
        restore()
      }
    })
  })

  describe('getLatestVersion', () => {
    it('returns null before any check', () => {
      const plugin = new GhUpdatePlugin({ currentVersion: '0.1.0' })
      expect(plugin.getLatestVersion()).toBeNull()
    })
  })

  describe('stop', () => {
    it('stops without error when no timer', () => {
      const plugin = new GhUpdatePlugin({ currentVersion: '0.1.0' })
      expect(() => plugin.stop()).not.toThrow()
    })
  })
})
