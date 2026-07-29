import { describe, it, expect } from 'bun:test'
import type { MigrationDB } from './types.ts'

// Import all migration modules
import * as init from './1640988000_init.ts'
import * as auxInit from './1640988000_aux_init.ts'
import * as m1 from './1717233556_v0.23_migrate.ts'
import * as m2 from './1717233557_v0.23_migrate2.ts'
import * as m3 from './1717233558_v0.23_migrate3.ts'
import * as m4 from './1717233559_v0.23_migrate4.ts'
import * as authAlert from './1763020353_update_default_auth_alert_templates.ts'
import * as indexes from './1778828400_normalize_indexes.ts'
import * as leastPrivilegeRoles from './1779000000_least_privilege_roles.ts'

// ---------------------------------------------------------------------------
// Mock MigrationDB that records SQL statements
// ---------------------------------------------------------------------------

function createMockDB(): { db: MigrationDB; executed: string[] } {
  const executed: string[] = []
  const db: MigrationDB = {
    raw: async (sql: string) => {
      executed.push(sql)
    },
  }
  return { db, executed }
}

describe('migrations', () => {
  describe('1640988000_init', () => {
    it('executes CREATE TABLE statements', async () => {
      const { db, executed } = createMockDB()
      await init.up(db)

      const allSql = executed.join(' ')
      expect(allSql).toContain('CREATE TABLE')
      expect(allSql).toContain('_migrations')
      expect(allSql).toContain('_params')
      expect(allSql).toContain('_collections')
    })

    it('down drops all tables', async () => {
      const { db, executed } = createMockDB()
      await init.down(db)

      const allSql = executed.join(' ')
      expect(allSql).toContain('DROP TABLE')
      expect(allSql).toContain('_collections')
      expect(allSql).toContain('_params')
      expect(allSql).toContain('_migrations')
    })
  })

  describe('1640988000_aux_init', () => {
    it('executes CREATE TABLE for auxiliary tables', async () => {
      const { db, executed } = createMockDB()
      await auxInit.up(db)

      const allSql = executed.join(' ')
      expect(allSql).toContain('_superusers')
      expect(allSql).toContain('_logs')
      expect(allSql).toContain('_externalAuths')
      expect(allSql).toContain('_authOrigins')
      expect(allSql).toContain('_mfas')
      expect(allSql).toContain('_otps')
    })

    it('includes index creation', async () => {
      const { db, executed } = createMockDB()
      await auxInit.up(db)

      const allSql = executed.join(' ')
      expect(allSql).toContain('CREATE INDEX')
    })
  })

  describe('v0.23 migrations', () => {
    it('m1 adds collection_id and type columns', async () => {
      const { db, executed } = createMockDB()
      await m1.up(db)

      const allSql = executed.join(' ')
      expect(allSql).toContain('ALTER TABLE')
      expect(allSql).toContain('collection_id')
      expect(allSql).toContain('_params')
    })

    it('m2 adds view_query and list_options', async () => {
      const { db, executed } = createMockDB()
      await m2.up(db)

      const allSql = executed.join(' ')
      expect(allSql).toContain('view_query')
      expect(allSql).toContain('list_options')
    })

    it('m3 adds auth_rule and manage_rule', async () => {
      const { db, executed } = createMockDB()
      await m3.up(db)

      const allSql = executed.join(' ')
      expect(allSql).toContain('auth_rule')
      expect(allSql).toContain('manage_rule')
    })

    it('m4 adds superuser columns and external auths index', async () => {
      const { db, executed } = createMockDB()
      await m4.up(db)

      const allSql = executed.join(' ')
      expect(allSql).toContain('_superusers')
      expect(allSql).toContain('token_key')
      expect(allSql).toContain('idx_externalAuths_provider_unique')
    })
  })

  describe('1763020353_update_default_auth_alert_templates', () => {
    it('updates auth alert template in _params', async () => {
      const { db, executed } = createMockDB()
      await authAlert.up(db)

      const allSql = executed.join(' ')
      expect(allSql).toContain('UPDATE')
      expect(allSql).toContain('_params')
      expect(allSql).toContain('auth_alert_template')
    })
  })

  describe('1779000000_least_privilege_roles', () => {
    it('creates all five application roles', async () => {
      const { db, executed } = createMockDB()
      await leastPrivilegeRoles.up(db)

      const allSql = executed.join(' ')
      expect(allSql).toContain('sinopebase_admin')
      expect(allSql).toContain('sinopebase_app')
      expect(allSql).toContain('anon')
      expect(allSql).toContain('authenticated')
      expect(allSql).toContain('service_role')
    })

    it('grants role memberships and schema privileges', async () => {
      const { db, executed } = createMockDB()
      await leastPrivilegeRoles.up(db)

      const allSql = executed.join(' ')
      expect(allSql).toContain('GRANT')
      expect(allSql).toContain('TO CURRENT_USER')
      expect(allSql).toContain('ALTER DEFAULT PRIVILEGES')
    })

    it('is idempotent (uses IF NOT EXISTS)', async () => {
      const { db, executed } = createMockDB()
      await leastPrivilegeRoles.up(db)

      const allSql = executed.join(' ')
      const createCount = (allSql.match(/CREATE ROLE/g) || []).length
      expect(createCount).toBeGreaterThanOrEqual(5)
      expect(allSql).toContain('IF NOT EXISTS')
    })

    it('down reverses all role creation', async () => {
      const { db, executed } = createMockDB()
      await leastPrivilegeRoles.down(db)

      const allSql = executed.join(' ')
      expect(allSql).toContain('DROP ROLE')
      expect(allSql).toContain('REVOKE')
      expect(allSql).toContain('ALTER DEFAULT PRIVILEGES')
    })
  })

  describe('1778828400_normalize_indexes', () => {
    it('creates indexes for all system tables', async () => {
      const { db, executed } = createMockDB()
      await indexes.up(db)

      const allSql = executed.join(' ')
      expect(allSql).toContain('CREATE INDEX')
      expect(allSql).toContain('idx_')
    })

    it('down drops created indexes', async () => {
      const { db, executed } = createMockDB()
      await indexes.down(db)

      const allSql = executed.join(' ')
      expect(allSql).toContain('DROP INDEX')
    })
  })
})
