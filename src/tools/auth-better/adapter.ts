/**
 * Kysely-based database adapter for better-auth.
 *
 * Wraps a pg.Pool in a typed Kysely instance so better-auth can run
 * its queries against the same PostgreSQL pool used by the rest of the
 * application.
 */

import { type Generated, Kysely, PostgresDialect, sql } from 'kysely'
import type pg from 'pg'

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export interface BetterAuthDatabase {
  user: {
    id: string
    email: string
    emailVerified: boolean
    emailVerifiedAt: Date | null
    userMetadata: Generated<Record<string, unknown>>
    name: string | null
    image: string | null
    role: string
    createdAt: Date
    updatedAt: Date
  }
  session: {
    id: string
    userId: string
    token: string
    expiresAt: Date
    ipAddress: string | null
    userAgent: string | null
    createdAt: Date
    updatedAt: Date
    authMethod: Generated<string | null>
  }
  account: {
    id: string
    userId: string
    providerId: string
    accountId: string
    providerUserId: string
    accessToken: string | null
    refreshToken: string | null
    expiresAt: Date | null
    idToken: string | null
    accessTokenExpiresAt: Date | null
    refreshTokenExpiresAt: Date | null
    scope: string | null
    password: string | null
    createdAt: Date
    updatedAt: Date
  }
  verification: {
    id: string
    identifier: string
    value: string
    expiresAt: Date
    createdAt: Date
    updatedAt: Date
  }
  refresh_tokens: {
    token_id: string
    user_id: string
    session_id: string
    family_id: string
    parent_token_id: string | null
    consumed: boolean
    compromised: boolean
    expires_at: Date
    created_at: Date
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a typed Kysely instance bound to the better-auth schema tables.
 *
 * Usage:
 *   const db = createBetterAuthDB(pool)
 *   await db.selectFrom('user').selectAll().execute()
 */
export function createBetterAuthDB(pool: pg.Pool): Kysely<BetterAuthDatabase> {
  return new Kysely<BetterAuthDatabase>({
    dialect: new PostgresDialect({ pool }),
  })
}

// ---------------------------------------------------------------------------
// Table creation
// ---------------------------------------------------------------------------

/**
 * Create all better-auth tables if they do not already exist.
 *
 * Safe to call on every startup — each statement uses `IF NOT EXISTS`.
 */
export async function createAuthTables(db: Kysely<BetterAuthDatabase>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS "user" (
      "id"            varchar(36) PRIMARY KEY,
      "email"         varchar(255) NOT NULL,
      "emailVerified" boolean      NOT NULL DEFAULT false,
      "name"          varchar(255),
      "image"         text,
      "role"          varchar(50)  NOT NULL DEFAULT 'user',
      "createdAt"     timestamptz  NOT NULL DEFAULT now(),
      "updatedAt"     timestamptz  NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS "session" (
      "id"        varchar(36)  PRIMARY KEY,
      "userId"    varchar(36)  NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      "token"     varchar(255) NOT NULL UNIQUE,
      "expiresAt" timestamptz  NOT NULL,
      "ipAddress" varchar(45),
      "userAgent" text,
      "createdAt" timestamptz  NOT NULL DEFAULT now(),
      "updatedAt" timestamptz  NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS "account" (
      "id"             varchar(36)  PRIMARY KEY,
      "userId"         varchar(36)  NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      "providerId"     varchar(50)  NOT NULL,
      "accountId"      varchar(255) NOT NULL,
      "providerUserId" varchar(255),
      "accessToken"    text,
      "refreshToken"   text,
      "expiresAt"      timestamptz,
      "password"       text,
      "createdAt"      timestamptz  NOT NULL DEFAULT now(),
      "updatedAt"      timestamptz  NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS "verification" (
      "id"         varchar(36)  PRIMARY KEY,
      "identifier" varchar(255) NOT NULL,
      "value"      text         NOT NULL,
      "expiresAt"  timestamptz  NOT NULL,
      "createdAt"  timestamptz  NOT NULL DEFAULT now(),
      "updatedAt"  timestamptz  NOT NULL DEFAULT now()
    );
  `.execute(db)
  // Better Auth 1.7 checks its schema and fails auth requests while these nullable account columns are missing.
  await sql`
    ALTER TABLE public.account ADD COLUMN IF NOT EXISTS "idToken" text;
    ALTER TABLE public.account ADD COLUMN IF NOT EXISTS "accessTokenExpiresAt" timestamptz;
    ALTER TABLE public.account ADD COLUMN IF NOT EXISTS "refreshTokenExpiresAt" timestamptz;
    ALTER TABLE public.account ADD COLUMN IF NOT EXISTS scope text;
  `.execute(db)
  // User-editable metadata stays separate from native authorization/verification fields.
  await sql`ALTER TABLE public."user" ADD COLUMN IF NOT EXISTS "userMetadata" jsonb NOT NULL DEFAULT '{}'::jsonb`.execute(
    db,
  )
  // GoTrue amr: recovery sessions may set a password without the current one.
  await sql`ALTER TABLE public."session" ADD COLUMN IF NOT EXISTS "authMethod" text`.execute(db)
  await sql`
    ALTER TABLE public."user" ADD COLUMN IF NOT EXISTS "emailVerifiedAt" timestamptz;
    CREATE OR REPLACE FUNCTION public.record_email_verification_time()
    RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
    BEGIN
      IF NOT NEW."emailVerified" THEN
        NEW."emailVerifiedAt" := NULL;
      ELSIF TG_OP = 'INSERT' THEN
        NEW."emailVerifiedAt" := clock_timestamp();
      ELSIF NOT OLD."emailVerified" OR lower(NEW.email) IS DISTINCT FROM lower(OLD.email) THEN
        NEW."emailVerifiedAt" := clock_timestamp();
      ELSE
        NEW."emailVerifiedAt" := OLD."emailVerifiedAt";
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE OR REPLACE TRIGGER record_email_verification_time
      BEFORE INSERT OR UPDATE ON public."user"
      FOR EACH ROW EXECUTE FUNCTION public.record_email_verification_time();
  `.execute(db)
}
