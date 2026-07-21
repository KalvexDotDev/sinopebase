import { describe, it, expect } from 'bun:test'
import {
  AdminUIPathPrefix,
  adminUI,
  getUIFiles,
  getUIFile,
  getAdminIndexHTML,
  initAdminUI,
} from './embed.ts'

describe('ui/embed', () => {
  describe('AdminUIPathPrefix', () => {
    it('is /_/', () => {
      expect(AdminUIPathPrefix).toBe('/_/')
    })
  })

  describe('adminUI', () => {
    it('starts as not available', () => {
      expect(adminUI.available).toBe(false)
    })
  })

  describe('getUIFiles', () => {
    it('returns empty array (stub)', () => {
      const files = getUIFiles()
      expect(files).toEqual([])
    })
  })

  describe('getUIFile', () => {
    it('returns undefined for any path (stub)', () => {
      expect(getUIFile('/index.html')).toBeUndefined()
    })
  })

  describe('getAdminIndexHTML', () => {
    it('returns a placeholder HTML page', () => {
      const html = getAdminIndexHTML()
      expect(html).toContain('<!DOCTYPE html>')
      expect(html).toContain('Sinopebase Admin')
      expect(html).toContain('</html>')
    })

    it('mentions the ui/dist directory', () => {
      const html = getAdminIndexHTML()
      expect(html).toContain('ui/dist')
    })
  })

  describe('initAdminUI', () => {
    it('handles missing dist directory gracefully', async () => {
      // Should not throw when dist doesn't exist
      await expect(initAdminUI('./nonexistent-path')).resolves.toBeUndefined()
    })

    it('remains unavailable when dist is missing', async () => {
      // Reset before test
      ;(adminUI as { available: boolean }).available = false
      await initAdminUI('./nonexistent-path')
      expect(adminUI.available).toBe(false)
    })
  })
})
