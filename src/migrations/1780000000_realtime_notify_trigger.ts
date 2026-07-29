/**
 * Migration: Add realtime NOTIFY trigger function for cross-process fan-out.
 *
 * Creates a PL/pgSQL trigger function that fires pg_notify() on
 * INSERT/UPDATE/DELETE to user tables. Each notification includes the
 * originating process_id so listeners can skip self-originated events.
 *
 * The trigger is NOT attached to any tables by this migration — that is
 * done by the application on startup via attachRealtimeTriggers().
 */

import type { Migration } from './types'

const migration: Migration = {
  id: '1780000000_realtime_notify_trigger',
  description: 'Create sinopebase_notify_change() trigger function for realtime fan-out',
  up: `
    CREATE OR REPLACE FUNCTION sinopebase_notify_change()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $$
    DECLARE
      payload json;
      exclude_tables text[] := ARRAY[
        '_migrations',
        '_collections',
        '_logs',
        '_admins',
        'schema_migrations'
      ];
    BEGIN
      -- Skip excluded/internal tables
      IF TG_TABLE_NAME = ANY(exclude_tables) THEN
        RETURN NEW;
      END IF;

      payload := json_build_object(
        'process_id', current_setting('app.sinopebase_process_id', true),
        'table', TG_TABLE_NAME,
        'schema', TG_TABLE_SCHEMA,
        'event', TG_OP,
        'new', CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN row_to_json(NEW) ELSE '{}'::json END,
        'old', CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN row_to_json(OLD) ELSE '{}'::json END
      );

      PERFORM pg_notify('sinopebase_changes', payload::text);
      RETURN NEW;
    END;
    $$;
  `,
  down: `
    DROP FUNCTION IF EXISTS sinopebase_notify_change() CASCADE;
  `,
}

export default migration
