/**
 * Revoke PUBLIC EXECUTE on functions in the public schema.
 *
 * Supabase hardening parity: PostgreSQL grants EXECUTE on new functions to
 * PUBLIC by default, which lets anonymous callers invoke anything, including
 * consumer-created SECURITY DEFINER routines that bypass RLS. After this
 * migration, functions are callable by anon/authenticated only after an
 * explicit GRANT EXECUTE.
 *
 * Postgres 18 does not persist ALTER DEFAULT PRIVILEGES revokes for
 * functions (no pg_default_acl row is stored), so an event trigger revokes
 * PUBLIC EXECUTE from every newly created function instead. Event triggers
 * require superuser — on managed databases the trigger creation is skipped
 * and only the one-time REVOKE below applies.
 */

import type { MigrationDB } from './types.ts'

export async function up(db: MigrationDB): Promise<void> {
  await db.raw(`
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

    CREATE OR REPLACE FUNCTION sinopebase_revoke_fn_execute()
    RETURNS event_trigger LANGUAGE plpgsql AS $$
    DECLARE
      obj record;
    BEGIN
      FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands()
        WHERE command_tag = 'CREATE FUNCTION'
      LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', obj.object_identity);
      END LOOP;
    END;
    $$;

    DO $$
    BEGIN
      BEGIN
        DROP EVENT TRIGGER IF EXISTS sinopebase_revoke_fn_execute;
        CREATE EVENT TRIGGER sinopebase_revoke_fn_execute
          ON ddl_command_end
          WHEN TAG IN ('CREATE FUNCTION')
          EXECUTE FUNCTION sinopebase_revoke_fn_execute();
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE WARNING 'sinopebase: not superuser — event trigger skipped. Functions created after this migration keep PUBLIC EXECUTE; grant EXECUTE explicitly and revoke PUBLIC manually.';
      END;
    END
    $$;

    -- auth.uid() is the one function request roles must always be able to call.
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'auth' AND p.proname = 'uid'
      ) THEN
        GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
      END IF;
    END
    $$;
  `)
}
