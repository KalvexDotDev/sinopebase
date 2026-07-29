import { describe, it, expect } from 'bun:test'
import { migrationTemplate, migrationTemplateJS, migrationFileName } from './templates.ts'

describe('migration templates', () => {
  describe('migrationTemplate', () => {
    it('generates TypeScript source with the given name', () => {
      const source = migrationTemplate('20240101_my_migration')
      expect(source).toContain('20240101_my_migration')
      expect(source).toContain('export async function up')
      expect(source).toContain('export async function down')
      expect(source).toContain('MigrationDB')
    })
  })

  describe('migrationTemplateJS', () => {
    it('generates JavaScript source without types', () => {
      const source = migrationTemplateJS('20240101_test')
      expect(source).toContain('20240101_test')
      expect(source).toContain('export async function up')
      // JS template includes MigrationDB in JSDoc type annotation, not in TS syntax
      expect(source).toContain('@param') // JSDoc annotation
    })
  })

  describe('migrationFileName', () => {
    it('returns .ts extension by default', () => {
      expect(migrationFileName('001_init')).toBe('001_init.ts')
    })

    it('returns .js extension when useTs is false', () => {
      expect(migrationFileName('001_init', false)).toBe('001_init.js')
    })
  })
})
