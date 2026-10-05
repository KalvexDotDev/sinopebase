import type { MigrationDB } from './types'

/** Publish committed row changes for listeners on every replica. */
export async function up(db: MigrationDB): Promise<void> {
  await db.raw(`
    CREATE OR REPLACE FUNCTION public.sinopebase_notify_change()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
    DECLARE payload text;
    BEGIN
      payload := pg_catalog.json_build_object(
          'table', TG_TABLE_NAME,
          'schema', TG_TABLE_SCHEMA,
          'event', TG_OP,
          'new', CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN pg_catalog.row_to_json(NEW) ELSE '{}'::json END,
          'old', CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN pg_catalog.row_to_json(OLD) ELSE '{}'::json END
        )::text;
      -- PostgreSQL limits NOTIFY payloads to 8000 bytes. Large rows must not
      -- turn an otherwise successful write into a transaction failure.
      IF pg_catalog.octet_length(payload) < 7900 THEN
        PERFORM pg_catalog.pg_notify('sinopebase_changes', payload);
      END IF;
      RETURN COALESCE(NEW, OLD);
    END;
    $$;
  `)
}

export async function down(db: MigrationDB): Promise<void> {
  await db.raw('DROP FUNCTION IF EXISTS public.sinopebase_notify_change() CASCADE')
}
