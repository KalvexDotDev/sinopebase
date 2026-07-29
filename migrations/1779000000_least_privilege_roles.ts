/**
 * Least-privilege database roles migration.
 *
 * Creates application roles (sinopebase_app, sinopebase_admin, anon,
 * authenticated, service_role) and grants minimal privileges so the
 * runtime connection runs as low-privilege sinopebase_app by default,
 * elevating only within request-scoped transactions via SET LOCAL ROLE.
 *
 * Layer 5 -- depends on ~/migrations/types.
 */

import type { MigrationDB } from './types.ts'

const REQUEST_ROLES = ['anon', 'authenticated', 'service_role'] as const

/**
 * Apply the least-privilege roles.
 */
export async function up(db: MigrationDB): Promise<void> {
  // ── sinopebase_admin — DDL-only role (used by migrations) ──
  await db.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sinopebase_admin') THEN
        CREATE ROLE sinopebase_admin
          NOLOGIN
          NOSUPERUSER
          CREATEDB
          CREATEROLE
          NOREPLICATION
          NOBYPASSRLS;
      END IF;
    END
    $$;
  `)

  // ── sinopebase_app — default runtime role (low privilege) ──
  // The connection pool authenticates as the owner but immediately
  // SET ROLE to sinopebase_app. Individual request transactions then
  // elevate further via SET LOCAL ROLE.
  await db.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sinopebase_app') THEN
        CREATE ROLE sinopebase_app
          NOLOGIN
          NOSUPERUSER
          NOCREATEDB
          NOCREATEROLE
          NOREPLICATION
          NOBYPASSRLS;
      END IF;
    END
    $$;
  `)

  // ── Request roles (must match PostgresRequestContext.role) ──
  for (const role of REQUEST_ROLES) {
    const bypassRls = role === 'service_role' ? 'BYPASSRLS' : 'NOBYPASSRLS'
    await db.raw(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
          CREATE ROLE ${role}
            NOLOGIN
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE
            NOREPLICATION
            ${bypassRls};
        END IF;
      END
      $$;
    `)
  }

  // ── Grant role memberships to the connection owner ──
  // Allows the pool to SET ROLE to any of these roles.
  const allRoles = [...REQUEST_ROLES, 'sinopebase_app', 'sinopebase_admin']
  await db.raw(`GRANT ${allRoles.join(', ')} TO CURRENT_USER`)

  // ── Schema-level privileges ──
  await db.raw('GRANT USAGE ON SCHEMA public TO anon, authenticated, sinopebase_app, service_role')

  // ── Default privileges for future tables ──
  // Any table created by the connection owner in schema public will
  // automatically inherit these grants.
  await db.raw(`
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT ON TABLES TO anon
  `)
  await db.raw(`
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated
  `)
  await db.raw(`
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT ALL ON TABLES TO service_role
  `)
  await db.raw(`
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT ALL ON TABLES TO sinopebase_app
  `)
}

/**
 * Rollback the least-privilege roles.
 */
export async function down(db: MigrationDB): Promise<void> {
  // Reset default privileges
  for (const role of ['anon', 'authenticated', 'service_role', 'sinopebase_app'] as const) {
    const privs = role === 'anon' ? 'SELECT' : role === 'authenticated' ? 'SELECT, INSERT, UPDATE, DELETE' : 'ALL'
    await db.raw(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ${privs} ON TABLES FROM ${role}`)
  }

  // Revoke schema usage
  await db.raw('REVOKE USAGE ON SCHEMA public FROM anon, authenticated, sinopebase_app, service_role')

  // Revoke role memberships
  const allRoles = ['anon', 'authenticated', 'service_role', 'sinopebase_app', 'sinopebase_admin']
  await db.raw(`REVOKE ${allRoles.join(', ')} FROM CURRENT_USER`)

  // Drop roles (order matters: dependent roles first)
  await db.raw('DROP ROLE IF EXISTS sinopebase_admin')
  await db.raw('DROP ROLE IF EXISTS sinopebase_app')
  await db.raw('DROP ROLE IF EXISTS service_role')
  await db.raw('DROP ROLE IF EXISTS authenticated')
  await db.raw('DROP ROLE IF EXISTS anon')
}
