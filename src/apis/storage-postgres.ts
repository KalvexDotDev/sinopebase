import { sql } from 'kysely'
import type { PostgresDatabase, PostgresRequestContext } from '../core/db-postgres'
import type { Bucket, FileObject } from '../tools/filesystem/store-interface'
import {
  StorageAccessError,
  type StorageAccessPolicy,
  type StorageBucketInput,
  type StorageUploadInput,
  validateBucketConstraints,
} from './storage-access'

interface BucketRow {
  id: string
  name: string
  owner_id: string | null
  public: boolean
  created_at: Date | string
  updated_at: Date | string
  file_size_limit: string | number | null
  allowed_mime_types: string[] | null
}

interface ObjectRow {
  id: string
  name: string
  created_at: Date | string | null
  updated_at: Date | string | null
  last_accessed_at: Date | string | null
  metadata: Record<string, unknown> | null
}

/**
 * Delegates storage authorization to PostgreSQL's storage.objects/buckets RLS.
 * The request role and auth.uid() come only from the server-verified context.
 */
export class PostgresStorageAccessPolicy implements StorageAccessPolicy {
  private readonly db: PostgresDatabase
  constructor(db: PostgresDatabase) {
    this.db = db
  }

  /**
   * Provision the storage metadata schema, tables, and role grants.
   * Idempotent — safe to call on every startup.
   */
  static async ensureMetadata(db: PostgresDatabase): Promise<void> {
    const writer = db.getWriter()

    await sql`CREATE SCHEMA IF NOT EXISTS storage`.execute(writer)

    await sql`
      CREATE TABLE IF NOT EXISTS storage.buckets (
        id text PRIMARY KEY,
        name text NOT NULL UNIQUE,
        owner_id text,
        public boolean NOT NULL DEFAULT false,
        file_size_limit integer,
        allowed_mime_types text[],
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `.execute(writer)

    await sql`
      CREATE TABLE IF NOT EXISTS storage.objects (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        bucket_id text NOT NULL REFERENCES storage.buckets(id) ON DELETE CASCADE,
        name text NOT NULL,
        owner_id text,
        metadata jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        last_accessed_at timestamptz,
        UNIQUE (bucket_id, name)
      )
    `.execute(writer)

    // Grant schema access and table permissions to request roles.
    await sql`GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role`
      .execute(writer)
      .catch(() => undefined)
    await sql`GRANT SELECT, INSERT ON storage.buckets TO anon, authenticated, service_role`.execute(
      writer,
    )
    await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated, service_role`.execute(
      writer,
    )
    // Also grant the sequences so inserts that generate UUIDs work under SET ROLE.
    await sql`GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role`
      .execute(writer)
      .catch(() => undefined)

    // Ensure the auth schema and auth.uid() function exist for RLS policies.
    // This mirrors Supabase's auth.uid() — reads the JWT sub claim set by
    // withRequestContext. Created here so RLS policy DDL below can reference it.
    await sql`CREATE SCHEMA IF NOT EXISTS auth`.execute(writer).catch(() => undefined)
    await sql`
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE
      AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$
    `.execute(writer)
    await sql`GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role`
      .execute(writer)
      .catch(() => undefined)
    await sql`GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role`
      .execute(writer)
      .catch(() => undefined)

    // Ensure auth.role() exists alongside auth.uid() for RLS policies.
    // Mirrors Supabase's auth.role() — returns the current request role.
    await sql`
      CREATE OR REPLACE FUNCTION auth.role() RETURNS text
      LANGUAGE sql STABLE
      AS $$ SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')::text $$
    `.execute(writer)
    await sql`GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role`
      .execute(writer)
      .catch(() => undefined)

    // Enable RLS on both tables.
    await sql`ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY`
      .execute(writer)
      .catch(() => undefined)
    await sql`ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY`
      .execute(writer)
      .catch(() => undefined)

    // ── RLS policies ──
    // Anon: can CRUD in public buckets; private buckets require auth.
    // Each operation checks bucket_id IN (SELECT id FROM storage.buckets WHERE public = true).
    // Authenticated: owner-scoped access — each user can only manage (update, delete) their own
    // objects, and insert with their own owner_id. SELECT allows owner match OR public bucket
    // so authenticated users can still read objects in shared/public buckets.
    await sql`
      DO $$ BEGIN
        -- Drop the legacy v0.4-Wave-0 permissive anon policy if it exists.
        IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'storage_anon_all_objects' AND tablename = 'objects' AND schemaname = 'storage') THEN
          EXECUTE 'DROP POLICY storage_anon_all_objects ON storage.objects';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'storage_anon_select_buckets' AND tablename = 'buckets' AND schemaname = 'storage') THEN
          CREATE POLICY storage_anon_select_buckets ON storage.buckets FOR SELECT TO anon USING (public = true);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'storage_anon_select_objects' AND tablename = 'objects' AND schemaname = 'storage') THEN
          CREATE POLICY storage_anon_select_objects ON storage.objects FOR SELECT TO anon
            USING (bucket_id IN (SELECT id FROM storage.buckets WHERE public = true));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'storage_anon_insert_objects' AND tablename = 'objects' AND schemaname = 'storage') THEN
          CREATE POLICY storage_anon_insert_objects ON storage.objects FOR INSERT TO anon
            WITH CHECK (bucket_id IN (SELECT id FROM storage.buckets WHERE public = true));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'storage_anon_update_objects' AND tablename = 'objects' AND schemaname = 'storage') THEN
          CREATE POLICY storage_anon_update_objects ON storage.objects FOR UPDATE TO anon
            USING (bucket_id IN (SELECT id FROM storage.buckets WHERE public = true))
            WITH CHECK (bucket_id IN (SELECT id FROM storage.buckets WHERE public = true));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'storage_anon_delete_objects' AND tablename = 'objects' AND schemaname = 'storage') THEN
          CREATE POLICY storage_anon_delete_objects ON storage.objects FOR DELETE TO anon
            USING (bucket_id IN (SELECT id FROM storage.buckets WHERE public = true));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'storage_auth_all_buckets' AND tablename = 'buckets' AND schemaname = 'storage') THEN
          CREATE POLICY storage_auth_all_buckets ON storage.buckets FOR ALL TO authenticated USING (true) WITH CHECK (true);
        END IF;
        -- Drop the legacy v0.4-Wave-0 permissive auth policy — replaced with owner-scoped policies below.
        IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'storage_auth_all_objects' AND tablename = 'objects' AND schemaname = 'storage') THEN
          EXECUTE 'DROP POLICY storage_auth_all_objects ON storage.objects';
        END IF;
        -- Owner-scoped SELECT: users see their own objects OR any object in a public bucket.
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'storage_auth_select_objects' AND tablename = 'objects' AND schemaname = 'storage') THEN
          CREATE POLICY storage_auth_select_objects ON storage.objects FOR SELECT TO authenticated
            USING (owner_id = auth.uid()::text OR bucket_id IN (SELECT id FROM storage.buckets WHERE public = true));
        END IF;
        -- Owner-scoped INSERT: users can only insert objects with their own owner_id.
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'storage_auth_insert_objects' AND tablename = 'objects' AND schemaname = 'storage') THEN
          CREATE POLICY storage_auth_insert_objects ON storage.objects FOR INSERT TO authenticated
            WITH CHECK (owner_id = auth.uid()::text);
        END IF;
        -- Owner-scoped UPDATE: users can only modify their own objects.
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'storage_auth_update_objects' AND tablename = 'objects' AND schemaname = 'storage') THEN
          CREATE POLICY storage_auth_update_objects ON storage.objects FOR UPDATE TO authenticated
            USING (owner_id = auth.uid()::text)
            WITH CHECK (owner_id = auth.uid()::text);
        END IF;
        -- Owner-scoped DELETE: users can only delete their own objects.
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'storage_auth_delete_objects' AND tablename = 'objects' AND schemaname = 'storage') THEN
          CREATE POLICY storage_auth_delete_objects ON storage.objects FOR DELETE TO authenticated
            USING (owner_id = auth.uid()::text);
        END IF;
      END $$;
    `
      .execute(writer)
      .catch(() => undefined)

    // Seed a default public bucket for development and test suites.
    await sql`
      INSERT INTO storage.buckets (id, name, public)
      VALUES ('test-bucket', 'test-bucket', true)
      ON CONFLICT (id) DO NOTHING
    `
      .execute(writer)
      .catch(() => undefined)
  }

  async isAvailable(): Promise<boolean> {
    try {
      const result = await sql<{ available: boolean }>`
        SELECT
          to_regclass('storage.buckets') IS NOT NULL
          AND to_regclass('storage.objects') IS NOT NULL AS available
      `.execute(this.db.getWriter())
      return result.rows[0]?.available ?? false
    } catch {
      return false
    }
  }

  async listBuckets(context: PostgresRequestContext): Promise<Bucket[]> {
    return this.scoped(context, async (db) => {
      const result = await sql<BucketRow>`
        SELECT id, name, owner_id, public, created_at, updated_at,
               file_size_limit, allowed_mime_types
        FROM storage.buckets
        ORDER BY name
      `.execute(db.getWriter())
      return result.rows.map(toBucket)
    })
  }

  async createBucket(
    context: PostgresRequestContext,
    input: StorageBucketInput,
    persist: () => Promise<unknown>,
  ): Promise<void> {
    await this.scoped(context, async (db) => {
      await sql`
        INSERT INTO storage.buckets (
          id, name, owner_id, public, file_size_limit, allowed_mime_types
        ) VALUES (
          ${input.name}, ${input.name}, ${context.userId ?? null}, ${input.public},
          ${input.fileSizeLimit ?? null}, ${input.allowedMimeTypes ?? null}
        )
      `.execute(db.getWriter())
      await persist()
    })
  }

  async listObjects(
    context: PostgresRequestContext,
    bucket: string,
    prefix = '',
  ): Promise<FileObject[]> {
    return this.scoped(context, async (db) => {
      const result = await sql<ObjectRow>`
        SELECT id, name, created_at, updated_at, last_accessed_at, metadata
        FROM storage.objects
        WHERE bucket_id = ${bucket} AND name LIKE ${`${prefix}%`}
        ORDER BY name
      `.execute(db.getWriter())
      return result.rows.map(toFileObject)
    })
  }

  async upload(
    context: PostgresRequestContext,
    input: StorageUploadInput,
    persist: () => Promise<unknown>,
  ): Promise<void> {
    const bucket = await this.getBucket(input.bucket)
    if (!bucket) throw new StorageAccessError(404, '404', 'Bucket not found')
    validateBucketConstraints(
      {
        fileSizeLimit: bucket.file_size_limit === null ? null : Number(bucket.file_size_limit),
        allowedMimeTypes: bucket.allowed_mime_types,
      },
      input,
    )

    await this.scoped(context, async (db) => {
      const metadata = JSON.stringify({
        mimetype:
          input.contentType.split(';', 1)[0]?.trim().toLowerCase() || 'application/octet-stream',
        size: input.data.byteLength,
        cacheControl: input.cacheControl,
      })
      if (input.upsert) {
        await sql`
          INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
          VALUES (${input.bucket}, ${input.path}, ${context.userId ?? null}, ${metadata}::jsonb)
          ON CONFLICT (bucket_id, name) DO UPDATE SET
            owner_id = EXCLUDED.owner_id,
            metadata = EXCLUDED.metadata,
            updated_at = now()
        `.execute(db.getWriter())
      } else {
        await sql`
          INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
          VALUES (${input.bucket}, ${input.path}, ${context.userId ?? null}, ${metadata}::jsonb)
        `.execute(db.getWriter())
      }
      await persist()
    })
  }

  async download(
    context: PostgresRequestContext,
    bucket: string,
    path: string,
    read: () => Promise<Buffer>,
  ): Promise<Buffer> {
    return this.scoped(context, async (db) => {
      const result = await sql<{ present: number }>`
        SELECT 1 AS present FROM storage.objects
        WHERE bucket_id = ${bucket} AND name = ${path}
        LIMIT 1
      `.execute(db.getWriter())
      if (!result.rows[0]) throw new StorageAccessError(404, '404', 'Object not found')
      return read()
    })
  }

  async remove(
    context: PostgresRequestContext,
    bucket: string,
    paths: string[],
    persist: (allowedPaths: string[]) => Promise<string[]>,
  ): Promise<string[]> {
    if (paths.length === 0) return []
    return this.scoped(context, async (db) => {
      const result = await sql<{ name: string }>`
        DELETE FROM storage.objects
        WHERE bucket_id = ${bucket} AND name IN (${sql.join(paths)})
        RETURNING name
      `.execute(db.getWriter())
      const allowedPaths = result.rows.map((row) => row.name)
      return allowedPaths.length ? persist(allowedPaths) : []
    })
  }

  async authorizeSignedUrl(
    context: PostgresRequestContext,
    bucket: string,
    path: string,
  ): Promise<void> {
    await this.scoped(context, async (db) => {
      const result = await sql<{ present: number }>`
        SELECT 1 AS present FROM storage.objects
        WHERE bucket_id = ${bucket} AND name = ${path}
        LIMIT 1
      `.execute(db.getWriter())
      if (!result.rows[0]) throw new StorageAccessError(404, '404', 'Object not found')
    })
  }

  async downloadPublic(bucket: string, path: string, read: () => Promise<Buffer>): Promise<Buffer> {
    try {
      const result = await sql<{ present: number }>`
        SELECT 1 AS present
        FROM storage.objects AS object
        JOIN storage.buckets AS bucket ON bucket.id = object.bucket_id
        WHERE object.bucket_id = ${bucket}
          AND object.name = ${path}
          AND bucket.public = true
        LIMIT 1
      `.execute(this.db.getWriter())
      if (!result.rows[0]) throw new StorageAccessError(404, '404', 'Object not found')
      return read()
    } catch (error) {
      throw mapDatabaseError(error)
    }
  }

  private async getBucket(id: string): Promise<BucketRow | undefined> {
    try {
      const result = await sql<BucketRow>`
        SELECT id, name, owner_id, public, created_at, updated_at,
               file_size_limit, allowed_mime_types
        FROM storage.buckets WHERE id = ${id} LIMIT 1
      `.execute(this.db.getWriter())
      return result.rows[0]
    } catch (error) {
      throw mapDatabaseError(error)
    }
  }

  private async scoped<T>(
    context: PostgresRequestContext,
    operation: (db: PostgresDatabase) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.db.withRequestContext(context, operation)
    } catch (error) {
      throw mapDatabaseError(error)
    }
  }
}

function mapDatabaseError(error: unknown): StorageAccessError {
  if (error instanceof StorageAccessError) return error
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  if (code === '42501')
    return new StorageAccessError(403, '403', 'Storage policy denied this operation')
  if (code === '23505')
    return new StorageAccessError(409, '409', 'The storage resource already exists')
  if (code === '23503') return new StorageAccessError(404, '404', 'Bucket not found')
  if (code === '42P01' || code === '3F000') {
    return new StorageAccessError(503, '503', 'Supabase storage metadata schema is unavailable')
  }
  return new StorageAccessError(500, '500', 'Storage metadata operation failed')
}

function toBucket(row: BucketRow): Bucket {
  return {
    id: row.id,
    name: row.name,
    owner: row.owner_id ?? '',
    public: row.public,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  }
}

function toFileObject(row: ObjectRow): FileObject {
  return {
    id: row.id,
    name: row.name,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    last_accessed_at: row.last_accessed_at ? new Date(row.last_accessed_at).toISOString() : null,
    metadata: row.metadata,
  }
}
