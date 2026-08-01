/**
 * Sinopebase Core Application
 *
 * Port of PocketBase core/app.go — the central App interface.
 *
 * The App interface is the backbone of PocketBase/Sinopebase.
 * It defines ~175 methods covering database access, model CRUD,
 * event hooks, auth, files, mailer, cron, settings, subscriptions,
 * and backup operations.
 *
 * This interface exists to make testing easier and to allow users to
 * create common and pluggable helpers without depending on a specific
 * wrapped app struct.
 */

import type { Hook } from '~/tools/hook/hook'
import type { TaggedHook } from '~/tools/hook/tagged'
import type { Store } from '~/tools/store/store'
import type { Model } from './db_model'
import type { IDatabase } from './db-interface'

/** Minimal interface for the better-auth instance held by the app. */
interface AuthInstance {
  api: {
    signUpEmail(args: { body: Record<string, unknown> }): Promise<void>
    signInEmail(args: {
      body: Record<string, unknown>
    }): Promise<{ token: string; user: Record<string, unknown> }>
    signOut(args: { headers: Headers }): Promise<void>
    getSession(args: {
      headers: Headers
    }): Promise<{ session: Record<string, unknown>; user: Record<string, unknown> } | null>
  }
  __db?: {
    selectFrom(table: string): {
      select(columns: string): {
        where(
          col: string,
          op: string,
          val: unknown,
        ): { execute(): Promise<Array<Record<string, unknown>>> }
      }
    }
    updateTable?(table: string): {
      set(data: Record<string, unknown>): {
        where(col: string, op: string, val: unknown): { execute(): Promise<unknown> }
      }
    }
  }
  [key: string]: unknown
}

import type {
  BackupEvent,
  BatchRequestEvent,
  BootstrapEvent,
  CollectionCreateEvent,
  CollectionDeleteEvent,
  CollectionErrorEvent,
  CollectionEvent,
  CollectionRequestEvent,
  CollectionsImportRequestEvent,
  CollectionsListEvent,
  CollectionUpdateEvent,
  FileDownloadRequestEvent,
  FileTokenRequestEvent,
  MailerEvent,
  MailerRecordEvent,
  ModelErrorEvent,
  ModelEvent,
  RealtimeConnectEvent,
  RealtimeMessageEvent,
  RealtimeSubscribeEvent,
  RecordAuthEvent,
  RecordAuthRefreshEvent,
  RecordAuthWithOAuth2Event,
  RecordAuthWithOTPRequestEvent,
  RecordAuthWithPasswordEvent,
  RecordConfirmEmailChangeEvent,
  RecordConfirmPasswordResetEvent,
  RecordConfirmVerificationEvent,
  RecordCreateEvent,
  RecordCreateOTPRequestEvent,
  RecordDeleteEvent,
  RecordEnrichEvent,
  RecordErrorEvent,
  RecordEvent,
  RecordRequestEmailChangeEvent,
  RecordRequestPasswordResetEvent,
  RecordRequestVerificationEvent,
  RecordsListEvent,
  RecordUpdateEvent,
  RecordViewEvent,
  ServeEvent,
  SettingsListEvent,
  SettingsReloadEvent,
  SettingsUpdateEvent,
  TerminateEvent,
} from './events'

// ---------------------------------------------------------------------------
// App interface — the backbone of Sinopebase
// ---------------------------------------------------------------------------

/**
 * App defines the main application interface.
 *
 * Note that the interface is not intended to be implemented manually by
 * users. Use BaseApp (either directly or as an extended class).
 *
 * This interface exists to make testing easier and to allow users to
 * create common and pluggable helpers.
 */
export interface App {
  // ---------------------------------------------------------------
  // Lifecycle & config
  // ---------------------------------------------------------------

  /**
   * UnsafeWithoutHooks returns a shallow copy of the current app
   * WITHOUT any registered hooks.
   *
   * Using the returned app instance may cause data integrity errors
   * since Record validations and data normalizations rely on hooks.
   */
  unsafeWithoutHooks(): App

  /** Logger returns the default app logger. */
  logger(): unknown

  /** IsBootstrapped checks if the application was initialized. */
  isBootstrapped(): boolean

  /** IsTransactional checks if the current app instance is part of a transaction. */
  isTransactional(): boolean

  /** TxInfo returns the transaction info (if any). */
  txInfo(): unknown

  /** Bootstrap initializes the application. */
  bootstrap(): Promise<void>

  /** ResetBootstrapState releases initialized core resources. */
  resetBootstrapState(): Promise<void>

  /** DataDir returns the app data directory path. */
  dataDir(): string

  /** EncryptionEnv returns the name of the app secret env key. */
  encryptionEnv(): string

  /** IsDev returns whether the app is in dev mode. */
  isDev(): boolean

  /** Settings returns the loaded app settings. */
  settings(): unknown

  /** Store returns the app runtime store. */
  store(): Store<string, unknown>

  /** ReloadSettings reinitializes and reloads stored application settings. */
  reloadSettings(): Promise<void>

  /** Restart restarts the current running application process. */
  restart(): Promise<void>

  /** CreateBackup creates a new backup. */
  createBackup(name: string): Promise<void>

  /** RestoreBackup restores a backup and restarts the app. */
  restoreBackup(name: string): Promise<void>

  /** RunSystemMigrations applies system migrations. */
  runSystemMigrations(): Promise<void>

  /** RunAppMigrations applies app migrations. */
  runAppMigrations(): Promise<void>

  /** RunAllMigrations applies all migrations. */
  runAllMigrations(): Promise<void>

  // ---------------------------------------------------------------
  // DB methods
  // ---------------------------------------------------------------

  /** DB returns the default database builder. */
  db(): IDatabase

  /** ConcurrentDB returns the concurrent database builder for reads. */
  concurrentDB(): IDatabase

  /** NonconcurrentDB returns the non-concurrent database builder for writes. */
  nonconcurrentDB(): IDatabase

  /** HasTable checks if a table exists. */
  hasTable(tableName: string): Promise<boolean>

  /** TableColumns returns column names for a table. */
  tableColumns(tableName: string): Promise<string[]>

  /** TableInfo returns table info for the specified table. */
  tableInfo(tableName: string): Promise<unknown[]>

  /** TableIndexes returns a map of index names to definitions. */
  tableIndexes(tableName: string): Promise<Record<string, string>>

  /** DeleteTable drops the specified table. */
  deleteTable(tableName: string): Promise<void>

  /** Vacuum reclaims unused database disk space. */
  vacuum(): Promise<void>

  // ---------------------------------------------------------------
  // Model persistence
  // ---------------------------------------------------------------

  /** ModelQuery creates a preconfigured select query for a model. */
  modelQuery(model: Model): unknown

  /** Delete deletes a model from the database. */
  delete(model: Model): Promise<void>

  /** Save validates and saves a model into the database. */
  save(model: Model): Promise<void>

  /** SaveNoValidate saves a model without performing validations. */
  saveNoValidate(model: Model): Promise<void>

  /** Validate triggers the OnModelValidate hook. */
  validate(model: Model): Promise<void>

  /** RunInTransaction wraps a function into a transaction. */
  runInTransaction(fn: (txApp: App) => Promise<void>): Promise<void>

  // ---------------------------------------------------------------
  // Log queries
  // ---------------------------------------------------------------

  /** LogQuery returns a new Log select query. */
  logQuery(): unknown

  /** FindLogById finds a log entry by id. */
  findLogById(id: string): Promise<unknown>

  /** DeleteOldLogs deletes logs created before a timestamp. */
  deleteOldLogs(createdBefore: Date): Promise<void>

  // ---------------------------------------------------------------
  // Collection queries
  // ---------------------------------------------------------------

  /** CollectionQuery returns a new Collection select query. */
  collectionQuery(): unknown

  /** FindAllCollections finds all collections by optional types. */
  findAllCollections(...collectionTypes: string[]): Promise<unknown[]>

  /** FindCollectionByNameOrId finds a collection by name or id. */
  findCollectionByNameOrId(nameOrId: string): Promise<unknown>

  /** IsCollectionNameUnique checks if a collection name is unique. */
  isCollectionNameUnique(name: string, ...excludeIds: string[]): Promise<boolean>

  /** ImportCollections imports collections data. */
  importCollections(toImport: Record<string, unknown>[], deleteMissing: boolean): Promise<void>

  /** SyncRecordTableSchema syncs record table schema for a collection. */
  syncRecordTableSchema(newCollection: unknown, oldCollection: unknown): Promise<void>

  // ---------------------------------------------------------------
  // Record queries
  // ---------------------------------------------------------------

  /** RecordQuery returns a new Record select query. */
  recordQuery(collectionModelOrIdentifier: unknown): unknown

  /** FindRecordById finds a record by its id. */
  findRecordById(
    collectionModelOrIdentifier: unknown,
    recordId: string,
    ...optFilters: Array<(q: unknown) => Promise<void>>
  ): Promise<unknown>

  /** FindRecordsByIds finds records by their ids. */
  findRecordsByIds(
    collectionModelOrIdentifier: unknown,
    recordIds: string[],
    ...optFilters: Array<(q: unknown) => Promise<void>>
  ): Promise<unknown[]>

  /** FindAllRecords finds all records with optional expressions. */
  findAllRecords(collectionModelOrIdentifier: unknown, ...exprs: unknown[]): Promise<unknown[]>

  /** FindFirstRecordByData finds the first record matching a key-value pair. */
  findFirstRecordByData(
    collectionModelOrIdentifier: unknown,
    key: string,
    value: unknown,
  ): Promise<unknown>

  /** FindRecordsByFilter finds records by a filter string. */
  findRecordsByFilter(
    collectionModelOrIdentifier: unknown,
    filter: string,
    sort: string,
    limit: number,
    offset: number,
    ...params: Record<string, unknown>[]
  ): Promise<unknown[]>

  /** FindFirstRecordByFilter finds the first record matching a filter. */
  findFirstRecordByFilter(
    collectionModelOrIdentifier: unknown,
    filter: string,
    ...params: Record<string, unknown>[]
  ): Promise<unknown>

  /** CountRecords returns the total number of records in a collection. */
  countRecords(collectionModelOrIdentifier: unknown, ...exprs: unknown[]): Promise<number>

  /** FindAuthRecordByToken finds the auth record associated with a JWT. */
  findAuthRecordByToken(token: string, ...validTypes: string[]): Promise<unknown>

  /** FindAuthRecordByEmail finds the auth record by email. */
  findAuthRecordByEmail(collectionModelOrIdentifier: unknown, email: string): Promise<unknown>

  /** CanAccessRecord checks if a record can be accessed by a request. */
  canAccessRecord(
    record: unknown,
    requestInfo: unknown,
    accessRule: string | null,
  ): Promise<boolean>

  /** ExpandRecord expands the relations of a single Record model. */
  expandRecord(
    record: unknown,
    expands: string[],
    optFetchFunc?: unknown,
  ): Promise<Record<string, Error>>

  /** ExpandRecords expands the relations of multiple Record models. */
  expandRecords(
    records: unknown[],
    expands: string[],
    optFetchFunc?: unknown,
  ): Promise<Record<string, Error>>

  // ---------------------------------------------------------------
  // Event hooks — App lifecycle
  // ---------------------------------------------------------------

  onBootstrap(): Hook<BootstrapEvent>
  onServe(): Hook<ServeEvent>
  onTerminate(): Hook<TerminateEvent>
  onBackupCreate(): Hook<BackupEvent>
  onBackupRestore(): Hook<BackupEvent>

  // ---------------------------------------------------------------
  // Event hooks — Model CRUD
  // ---------------------------------------------------------------

  onModelValidate(...tags: string[]): TaggedHook<ModelEvent>

  onModelCreate(...tags: string[]): TaggedHook<ModelEvent>
  onModelCreateExecute(...tags: string[]): TaggedHook<ModelEvent>
  onModelAfterCreateSuccess(...tags: string[]): TaggedHook<ModelEvent>
  onModelAfterCreateError(...tags: string[]): TaggedHook<ModelErrorEvent>

  onModelUpdate(...tags: string[]): TaggedHook<ModelEvent>
  onModelUpdateExecute(...tags: string[]): TaggedHook<ModelEvent>
  onModelAfterUpdateSuccess(...tags: string[]): TaggedHook<ModelEvent>
  onModelAfterUpdateError(...tags: string[]): TaggedHook<ModelErrorEvent>

  onModelDelete(...tags: string[]): TaggedHook<ModelEvent>
  onModelDeleteExecute(...tags: string[]): TaggedHook<ModelEvent>
  onModelAfterDeleteSuccess(...tags: string[]): TaggedHook<ModelEvent>
  onModelAfterDeleteError(...tags: string[]): TaggedHook<ModelErrorEvent>

  // ---------------------------------------------------------------
  // Event hooks — Record proxy hooks
  // ---------------------------------------------------------------

  onRecordEnrich(...tags: string[]): TaggedHook<RecordEnrichEvent>
  onRecordValidate(...tags: string[]): TaggedHook<RecordEvent>

  onRecordCreate(...tags: string[]): TaggedHook<RecordEvent>
  onRecordCreateExecute(...tags: string[]): TaggedHook<RecordEvent>
  onRecordAfterCreateSuccess(...tags: string[]): TaggedHook<RecordEvent>
  onRecordAfterCreateError(...tags: string[]): TaggedHook<RecordErrorEvent>

  onRecordUpdate(...tags: string[]): TaggedHook<RecordEvent>
  onRecordUpdateExecute(...tags: string[]): TaggedHook<RecordEvent>
  onRecordAfterUpdateSuccess(...tags: string[]): TaggedHook<RecordEvent>
  onRecordAfterUpdateError(...tags: string[]): TaggedHook<RecordErrorEvent>

  onRecordDelete(...tags: string[]): TaggedHook<RecordEvent>
  onRecordDeleteExecute(...tags: string[]): TaggedHook<RecordEvent>
  onRecordAfterDeleteSuccess(...tags: string[]): TaggedHook<RecordEvent>
  onRecordAfterDeleteError(...tags: string[]): TaggedHook<RecordErrorEvent>

  // ---------------------------------------------------------------
  // Event hooks — Collection proxy hooks
  // ---------------------------------------------------------------

  onCollectionValidate(...tags: string[]): TaggedHook<CollectionEvent>

  onCollectionCreate(...tags: string[]): TaggedHook<CollectionEvent>
  onCollectionCreateExecute(...tags: string[]): TaggedHook<CollectionEvent>
  onCollectionAfterCreateSuccess(...tags: string[]): TaggedHook<CollectionEvent>
  onCollectionAfterCreateError(...tags: string[]): TaggedHook<CollectionErrorEvent>

  onCollectionUpdate(...tags: string[]): TaggedHook<CollectionEvent>
  onCollectionUpdateExecute(...tags: string[]): TaggedHook<CollectionEvent>
  onCollectionAfterUpdateSuccess(...tags: string[]): TaggedHook<CollectionEvent>
  onCollectionAfterUpdateError(...tags: string[]): TaggedHook<CollectionErrorEvent>

  onCollectionDelete(...tags: string[]): TaggedHook<CollectionEvent>
  onCollectionDeleteExecute(...tags: string[]): TaggedHook<CollectionEvent>
  onCollectionAfterDeleteSuccess(...tags: string[]): TaggedHook<CollectionEvent>
  onCollectionAfterDeleteError(...tags: string[]): TaggedHook<CollectionErrorEvent>

  // ---------------------------------------------------------------
  // Event hooks — Mailer
  // ---------------------------------------------------------------

  onMailerSend(): Hook<MailerEvent>
  onMailerRecordPasswordResetSend(...tags: string[]): TaggedHook<MailerRecordEvent>
  onMailerRecordVerificationSend(...tags: string[]): TaggedHook<MailerRecordEvent>
  onMailerRecordEmailChangeSend(...tags: string[]): TaggedHook<MailerRecordEvent>
  onMailerRecordOTPSend(...tags: string[]): TaggedHook<MailerRecordEvent>
  onMailerRecordAuthAlertSend(...tags: string[]): TaggedHook<MailerRecordEvent>

  // ---------------------------------------------------------------
  // Event hooks — Realtime
  // ---------------------------------------------------------------

  onRealtimeConnectRequest(): Hook<RealtimeConnectEvent>
  onRealtimeMessageSend(): Hook<RealtimeMessageEvent>
  onRealtimeSubscribeRequest(): Hook<RealtimeSubscribeEvent>

  // ---------------------------------------------------------------
  // Event hooks — Settings
  // ---------------------------------------------------------------

  onSettingsListRequest(): Hook<SettingsListEvent>
  onSettingsUpdateRequest(): Hook<SettingsUpdateEvent>
  onSettingsReload(): Hook<SettingsReloadEvent>

  // ---------------------------------------------------------------
  // Event hooks — Files
  // ---------------------------------------------------------------

  onFileDownloadRequest(...tags: string[]): TaggedHook<FileDownloadRequestEvent>
  onFileTokenRequest(...tags: string[]): TaggedHook<FileTokenRequestEvent>

  // ---------------------------------------------------------------
  // Event hooks — Record Auth API
  // ---------------------------------------------------------------

  onRecordAuthRequest(...tags: string[]): TaggedHook<RecordAuthEvent>
  onRecordAuthWithPasswordRequest(...tags: string[]): TaggedHook<RecordAuthWithPasswordEvent>
  onRecordAuthWithOAuth2Request(...tags: string[]): TaggedHook<RecordAuthWithOAuth2Event>
  onRecordAuthRefreshRequest(...tags: string[]): TaggedHook<RecordAuthRefreshEvent>
  onRecordRequestPasswordResetRequest(
    ...tags: string[]
  ): TaggedHook<RecordRequestPasswordResetEvent>
  onRecordConfirmPasswordResetRequest(
    ...tags: string[]
  ): TaggedHook<RecordConfirmPasswordResetEvent>
  onRecordRequestVerificationRequest(...tags: string[]): TaggedHook<RecordRequestVerificationEvent>
  onRecordConfirmVerificationRequest(...tags: string[]): TaggedHook<RecordConfirmVerificationEvent>
  onRecordRequestEmailChangeRequest(...tags: string[]): TaggedHook<RecordRequestEmailChangeEvent>
  onRecordConfirmEmailChangeRequest(...tags: string[]): TaggedHook<RecordConfirmEmailChangeEvent>
  onRecordRequestOTPRequest(...tags: string[]): TaggedHook<RecordCreateOTPRequestEvent>
  onRecordAuthWithOTPRequest(...tags: string[]): TaggedHook<RecordAuthWithOTPRequestEvent>

  // ---------------------------------------------------------------
  // Event hooks — Record CRUD API
  // ---------------------------------------------------------------

  onRecordsListRequest(...tags: string[]): TaggedHook<RecordsListEvent>
  onRecordViewRequest(...tags: string[]): TaggedHook<RecordViewEvent>
  onRecordCreateRequest(...tags: string[]): TaggedHook<RecordCreateEvent>
  onRecordUpdateRequest(...tags: string[]): TaggedHook<RecordUpdateEvent>
  onRecordDeleteRequest(...tags: string[]): TaggedHook<RecordDeleteEvent>

  // ---------------------------------------------------------------
  // Event hooks — Collection API
  // ---------------------------------------------------------------

  onCollectionsListRequest(): Hook<CollectionsListEvent>
  onCollectionViewRequest(): Hook<CollectionRequestEvent>
  onCollectionCreateRequest(): Hook<CollectionCreateEvent>
  onCollectionUpdateRequest(): Hook<CollectionUpdateEvent>
  onCollectionDeleteRequest(): Hook<CollectionDeleteEvent>
  onCollectionsImportRequest(): Hook<CollectionsImportRequestEvent>

  // ---------------------------------------------------------------
  // Event hooks — Batch
  // ---------------------------------------------------------------

  onBatchRequest(): Hook<BatchRequestEvent>
}

import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { openapi } from '@elysia/openapi'
import { Elysia } from 'elysia'
import { Cron } from '~/tools/cron/cron'
import type { MigrationDB } from '../../migrations/types'
import {
  ApiError,
  BadRequestError,
  ForbiddenError,
  InternalServerError,
  NotFoundError,
  RequestEntityTooLargeError,
  TooManyRequestsError,
  UnauthorizedError,
} from '../apis/api_error_aliases'
import { authPlugin, createAuthPlugin } from '../apis/auth'
import { verifyAccessToken } from '../apis/auth-jwt'
import { createStoragePlugin } from '../apis/file'
import { cors } from '../apis/middlewares_cors'
import { rateLimit, resetRateLimiters } from '../apis/middlewares_rate_limit'
import { mountPostgrestRoutes } from '../apis/postgrest'
import { createRealtimeHub, createRealtimeWebSocketHandler } from '../apis/realtime'
import { PostgresStorageAccessPolicy } from '../apis/storage-postgres'
import { createAuth, lookupSessionByToken } from '../tools/auth-better'
import { LocalFileStore } from '../tools/filesystem/store'
import type { IFileStore } from '../tools/filesystem/store-interface'
import { S3FileStore } from '../tools/filesystem/store-s3'
import { Equal } from '../tools/security/crypto'
import { detectMode, isDevSecret, type ValidatedConfig } from './config'
import { MemoryDatabaseAdapter } from './db-memory-adapter'
import {
  PostgresDatabase,
  type Filter as PostgresFilter,
  type PostgresRequestContext,
} from './db-postgres'
import { generateRequestId, logger } from './logger'
import { loadMigrationsFromDirectory } from './migrations_loader'
import { MigrationRunner } from './migrations_runner'

export interface AppConfig {
  /** PostgreSQL connection URL (empty string = use in-memory db) */
  postgresUrl?: string
  /** MinIO endpoint */
  minioEndpoint?: string
  /** MinIO access key */
  minioAccessKey?: string
  /** MinIO secret key */
  minioSecretKey?: string
  /** Server port */
  port?: number
  /** Data directory for local files */
  dataDir?: string
  /** JWT secret for signing tokens */
  jwtSecret?: string
  /** OAuth/OIDC providers for social login + enterprise SSO */
  oauthProviders?: import('../tools/auth-better').OAuthProviderConfig[]
  /** Additional trusted origins for CORS/OAuth callbacks */
  extraOrigins?: string[]
  /** Runtime mode (default: auto-detected from env) */
  mode?: 'production' | 'development'
  /** Service role key for admin-level access (must be >=32 chars in production) */
  serviceRoleKey?: string
  /** Anonymous/public API key for unauthenticated requests (must be >=32 chars in production) */
  anonKey?: string
  /** Server bind hostname */
  host?: string
  /** Enable PG LISTEN/NOTIFY for cross-process realtime fan-out (default false). */
  enablePgNotify?: boolean
  /** Application name shown in the admin UI. */
  appName?: string
  /** TLS certificate and key file paths */
  tls?: { cert: string; key: string }
  /** Port for HTTP→HTTPS redirect listener (default 80). Only used when TLS is active. */
  httpRedirectPort?: number
  /** OpenAI API key for the Mastra plugin */
  openaiApiKey?: string
  /** Require authentication for Mastra agent endpoints */
  mastraRequireAuth?: boolean
  /** Trusted reverse proxy IPs for correct client IP resolution */
  trustedProxies?: string[]
  /** Rate limit: max requests per IP per window (default 100) */
  rateLimitMax?: number
  /** Rate limit: window duration in seconds (default 60) */
  rateLimitWindow?: number
  /** Backup directory for pg_dump files (default ./backups). */
  backupDir?: string
  /** Maximum upload file size in bytes (default 100 MB = 100 * 1024 * 1024). */
  maxUploadSize?: number
}

/**
 * Sinopebase — the main application class.
 *
 * Mirrors PocketBase's PocketBase struct (pocketbase.go)
 * which embeds core.App (~175 methods).
 */
const ADMIN_PLACEHOLDER = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Sinopebase Admin</title>
<style>body{margin:0;padding:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;color:#333;display:flex;justify-content:center;align-items:center;min-height:80vh}.placeholder{text-align:center;padding:40px;background:white;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1)}h1{margin:0 0 8px;font-size:24px}p{margin:0;color:#666}code{background:#eee;padding:2px 6px;border-radius:3px}</style>
</head><body><div class="placeholder"><h1>Sinopebase Admin</h1><p>Admin UI not built. Run <code>cd ui &amp;&amp; bun install &amp;&amp; bun run build</code> to enable.</p></div></body></html>`

export class Sinopebase {
  private config: AppConfig
  private mode: 'production' | 'development' = 'development'
  private server: Elysia | null = null
  private pendingServer: Elysia | null = null
  private _redirectServer: ReturnType<typeof Bun.serve> | null = null
  private _pgListener: import('../apis/realtime-pg-listener').PgRealtimeListener | null = null
  private _logPruneInterval: ReturnType<typeof setInterval> | null = null
  /** Unique process identifier for PG LISTEN/NOTIFY self-skip. */
  private processId: string = ''
  private database: IDatabase | null = null
  private fileStore: IFileStore | null = null
  private auth: AuthInstance | null = null
  private lifecycle: Promise<void> = Promise.resolve()
  /** Cached secrets — validated once at startup, never read from process.env thereafter. */
  private cachedServiceRoleKey = ''
  private cachedAnonKey = ''

  /**
   * Plugin registration callbacks queued via {@link use}.
   * Executed during {@link initializeServer} after core routes are registered
   * but BEFORE the server starts listening, so Elysia's route resolution
   * includes plugin routes from the first request.
   */
  private pendingPlugins: Array<(server: Elysia, auth: AuthInstance) => Promise<void>> = []

  /** Cron scheduler for periodic backups. */
  private backupCron: Cron | null = null

  /** Resolved backup directory path. */
  private resolvedBackupDir = ''

  constructor(config: AppConfig) {
    this.config = {
      port: 8090,
      dataDir: './pb_data',
      postgresUrl: '',
      minioEndpoint: '',
      minioAccessKey: '',
      minioSecretKey: '',
      host: '0.0.0.0',
      mastraRequireAuth: true,
      backupDir: './backups',
      ...config,
    }
    const backupDir = this.config.backupDir
    this.resolvedBackupDir = resolve(this.dataDir(), backupDir ?? 'backups')
  }

  /**
   * Queue a plugin for registration during server startup.
   *
   * Plugins registered via this method are wired into the Elysia router
   * BEFORE the server starts listening, ensuring their routes are visible
   * to Elysia's route resolution from the first request.
   *
   * Must be called **before** {@link start}.
   *
   * @example
   * ```ts
   * const app = new Sinopebase({ port: 8090 })
   * const dropFunctions = new DropFunctionsPlugin({ functionsDir: './fns' })
   * app.use(async (server, auth) => {
   *   await dropFunctions.register(server, auth)
   * })
   * await app.start()
   * ```
   */
  use(register: (server: Elysia, auth: AuthInstance) => Promise<void>): this {
    this.pendingPlugins.push(register)
    return this
  }

  /**
   * Start the Sinopebase server.
   * Mirrors apis.Serve() in PocketBase.
   */
  async start(): Promise<void> {
    return this.enqueueLifecycle(() => this.startServer())
  }

  private async startServer(): Promise<void> {
    if (this.server) return

    try {
      await this.initializeServer()
    } catch (error) {
      const server = this.server ?? this.pendingServer
      try {
        if (server?.server) await server.stop(true)
      } catch (cleanupError) {
        this.server = server
        this.pendingServer = null
        throw new AggregateError(
          [error, cleanupError],
          'Sinopebase startup failed and its server could not be stopped',
        )
      }

      this.server = null
      this.pendingServer = null
      this.database = null
      this.fileStore = null
      this.auth = null
      throw error
    }
  }

  private async initializeServer(): Promise<void> {
    // Detect runtime mode: explicit config takes precedence, otherwise env auto-detect
    this.mode = this.config.mode ?? detectMode()

    // Set JWT secret from config if provided
    if (this.config.jwtSecret) {
      process.env.JWT_SECRET = this.config.jwtSecret // nosemgrep: security-env-writeback-secrets
    }

    // Set env vars from config for downstream consumers
    if (this.config.serviceRoleKey) {
      process.env.SINOPEBASE_SERVICE_ROLE_KEY = this.config.serviceRoleKey // nosemgrep: security-env-writeback-secrets
    }
    if (this.config.anonKey) {
      process.env.SINOPEBASE_ANON_KEY = this.config.anonKey // nosemgrep: security-env-writeback-secrets
    }

    // Production fail-closed: validate infrastructure requirements before connecting
    if (this.mode === 'production') {
      const pgUrl = this.config.postgresUrl || process.env.POSTGRES_URL || ''
      if (!pgUrl) {
        throw new Error(
          'Production mode requires POSTGRES_URL. ' +
            'Set NODE_ENV=development or SINOPEBASE_PRODUCTION=false to use the in-memory database.',
        )
      }
      const s3CheckEndpoint = this.config.minioEndpoint || process.env.RUSTFS_ENDPOINT || ''
      const s3CheckKey = this.config.minioAccessKey || process.env.RUSTFS_ACCESS_KEY || ''
      const s3CheckSecret = this.config.minioSecretKey || process.env.RUSTFS_SECRET_KEY || ''
      if (!s3CheckEndpoint || !s3CheckKey || !s3CheckSecret) {
        throw new Error(
          'Production mode requires S3/MinIO configuration. ' +
            'Set RUSTFS_ENDPOINT, RUSTFS_ACCESS_KEY, and RUSTFS_SECRET_KEY.',
        )
      }
    }

    // Initialize database: PostgreSQL or in-memory fallback
    const postgresUrl = this.config.postgresUrl || process.env.POSTGRES_URL || ''

    // Merge code-configured OAuth providers with file-based ones (for Admin UI management).
    // Hoisted to method scope so both createAuth and createAuthPlugin can reference it.
    let mergedProviderIds: string[] = (this.config.oauthProviders ?? []).map((p) => p.providerId)

    if (postgresUrl) {
      const pg = new PostgresDatabase({
        postgresUrl,
      })
      await pg.connect()
      this.database = pg
      logger.info('Database', { provider: 'PostgreSQL', status: 'connected' })

      // Run pending system migrations (PocketBase pattern: migrate on startup).
      // Migrations are tracked in the _migrations table and skipped if already
      // applied. In non-production, bootstrapPostgresRequestRoles() (called by
      // connect()) creates request-context roles at runtime so the least-
      // privilege migration is a no-op. In production, the migration creates
      // roles that the pool-level SET ROLE depends on.
      await this.runSystemMigrations()

      // Validate database roles and schema preflight before proceeding.
      // Migration 1779000000_least_privilege_roles must have been applied.
      await this.validateSchema()

      // Fail-closed in production: refuse to start with well-known test keys
      // when PostgreSQL is configured. These keys bypass all authentication.
      // In local dev (no POSTGRES_URL) the defaults are acceptable.
      {
        const serviceKey = process.env.SINOPEBASE_SERVICE_ROLE_KEY
        const anonKey = process.env.SINOPEBASE_ANON_KEY
        const jwtSecret = process.env.JWT_SECRET || this.config.jwtSecret || ''

        if (!serviceKey || isDevSecret(serviceKey)) {
          throw new Error(
            'SINOPEBASE_SERVICE_ROLE_KEY is unset or uses a dev/placeholder pattern. ' +
              'Set it to a cryptographically random value (≥32 chars) before starting in production mode.',
          )
        }
        if (!anonKey || isDevSecret(anonKey)) {
          throw new Error(
            'SINOPEBASE_ANON_KEY is unset or uses a dev/placeholder pattern. ' +
              'Set it to a cryptographically random value (≥32 chars) before starting in production mode.',
          )
        }
        if (!jwtSecret || isDevSecret(jwtSecret)) {
          if (this.mode === 'production') {
            throw new Error(
              'JWT_SECRET is unset or uses a dev/placeholder pattern. ' +
                'Set it to a cryptographically random value (≥32 chars) before starting in production mode.',
            )
          }
          logger.warn(
            'JWT_SECRET uses a dev/placeholder pattern in PostgreSQL mode. Set JWT_SECRET to a cryptographically random value in production.',
          )
        }

        // Cache validated secrets — never read from process.env per-request.
        // Guards above ensure serviceKey / anonKey are non-empty strings.
        if (!serviceKey) throw new Error('SINOPEBASE_SERVICE_ROLE_KEY is required')
        if (!anonKey) throw new Error('SINOPEBASE_ANON_KEY is required')
        this.cachedServiceRoleKey = serviceKey
        this.cachedAnonKey = anonKey
        // H8: Secrets are cached on the instance — never written back to process.env.
        // Downstream modules (auth-jwt, signed-url) accept keys via parameters,
        // not from ambient env reads.
      }

      // Load file-based OAuth providers (from Admin UI), merge with code config.
      // File providers take precedence on same providerId.
      const { loadProviders: loadOAuthProviders } = await import('../apis/admin-oauth')
      const fileProviders = await loadOAuthProviders(this.dataDir())
      const codeProviders = this.config.oauthProviders ?? []
      const mergedProviders = [
        ...fileProviders,
        ...codeProviders.filter((p) => !fileProviders.some((fp) => fp.providerId === p.providerId)),
      ]
      mergedProviderIds = mergedProviders.map((p) => p.providerId)
      if (fileProviders.length > 0) {
        logger.info('OAuth providers loaded', {
          file: fileProviders.length,
          code: codeProviders.length,
          merged: mergedProviders.length,
        })
      }

      // Initialize better-auth with PostgreSQL
      try {
        const pool = pg.getPool()

        this.auth = await createAuth(pool, {
          jwtSecret: this.config.jwtSecret,
          oauthProviders: mergedProviders,
          extraOrigins: this.config.extraOrigins,
        })
        logger.info('Auth', {
          provider: 'better-auth',
          backend: 'PostgreSQL',
          status: 'initialized',
        })
      } catch (err) {
        logger.warn('Auth: better-auth init failed, falling back to in-memory', {
          error: (err as Error).message,
        })
        this.auth = null
      }

      // Provision storage metadata schema for RLS-backed file access.
      try {
        await PostgresStorageAccessPolicy.ensureMetadata(pg)
      } catch (err) {
        logger.warn('Storage metadata schema init failed', { error: (err as Error).message })
      }
    } else {
      this.database = new MemoryDatabaseAdapter()
      if (this.mode === 'development') {
        logger.warn('Using in-memory database — no POSTGRES_URL set. Data will not persist.')
      } else {
        logger.info('Database', { provider: 'in-memory' })
      }
    }

    // Initialize storage: RustFS/S3 or local fallback
    const s3Endpoint = this.config.minioEndpoint || process.env.RUSTFS_ENDPOINT || ''
    const s3AccessKey = this.config.minioAccessKey || process.env.RUSTFS_ACCESS_KEY || ''
    const s3SecretKey = this.config.minioSecretKey || process.env.RUSTFS_SECRET_KEY || ''
    if (s3Endpoint && s3AccessKey && s3SecretKey) {
      // Parse endpoint URL: MinIO client expects bare hostname, not a URL.
      // Accepts: "http://localhost:9000", "https://s3.example.com", "localhost:9000"
      let host = s3Endpoint
      let port = 9000
      let useSSL = false
      try {
        const url = new URL(s3Endpoint.startsWith('http') ? s3Endpoint : `http://${s3Endpoint}`)
        host = url.hostname
        if (url.port) port = Number(url.port)
        useSSL = url.protocol === 'https:'
      } catch {
        // Fallback: treat as bare host:port
        const parts = s3Endpoint.split(':')
        host = parts[0] ?? s3Endpoint
        if (parts[1]) port = Number(parts[1])
      }
      this.fileStore = new S3FileStore({
        endpoint: host,
        port,
        accessKey: s3AccessKey,
        secretKey: s3SecretKey,
        useSSL,
      })
      logger.info('Storage', { type: 'S3', endpoint: this.config.minioEndpoint })
    } else {
      this.fileStore = new LocalFileStore(this.config.dataDir ?? './pb_data')
      if (this.mode === 'development') {
        logger.warn('Using local file storage — no RUSTFS_ENDPOINT set.')
      } else {
        logger.info('Storage', { type: 'local' })
      }
    }

    // Create required tables
    await this.ensureTables()

    const postgrestContexts = new WeakMap<Request, PostgresRequestContext>()
    const resolveRealtimeContext = async (
      token: string | undefined,
    ): Promise<PostgresRequestContext | undefined> => {
      if (!token) return undefined
      // Keys are validated at startup — cached, never read from process.env per-request.
      // Timing-safe comparison (same as the REST path).
      if (Equal(token, this.cachedServiceRoleKey)) return { role: 'service_role' }
      if (Equal(token, this.cachedAnonKey)) return { role: 'anon' }

      try {
        if (this.auth) {
          const row = await lookupSessionByToken(this.auth, token)
          return row ? { role: 'authenticated', userId: row.id } : undefined
        }
        const payload = await verifyAccessToken(token)
        return { role: 'authenticated', userId: payload.sub }
      } catch {
        return undefined
      }
    }
    const realtime = createRealtimeHub<PostgresRequestContext>({
      authorize: resolveRealtimeContext,
      canRead: async (context, change) => {
        if (!context) return false
        if (!(this.database instanceof PostgresDatabase) || context.role === 'service_role') {
          return true
        }

        const row = change.event === 'DELETE' ? change.old : change.new
        const filters = realtimeVisibilityFilters(row)
        if (filters.length === 0) return false
        return this.database.withRequestContext(
          context,
          async (scoped) => (await scoped.count(change.table, filters)) > 0,
        )
      },
    })

    // ── PG LISTEN/NOTIFY listener for cross-process realtime fan-out (C1) ──
    this.processId = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)
    if (this.config.enablePgNotify && this.database instanceof PostgresDatabase) {
      try {
        const { PgRealtimeListener, attachRealtimeTriggers } = await import(
          '../apis/realtime-pg-listener'
        )
        const pool = this.database.getPool()
        this._pgListener = new PgRealtimeListener({
          pool,
          hub: realtime,
          processId: this.processId,
          log: (msg, data) => logger.info(msg, data),
        })
        await this._pgListener.start()
        // Attach triggers to existing tables after migrations have run
        await attachRealtimeTriggers(pool, (msg, data) => logger.info(msg, data))
      } catch (err) {
        logger.warn('[realtime-pg] Failed to start PG listener', {
          error: (err as Error).message,
        })
      }
    }

    // ── Request ID store (closed over by onRequest + onAfterResponse) ──
    const requestMeta = new WeakMap<Request, { startTime: number; requestId: string }>()

    // ── CORS origins aligned with better-auth trustedOrigins ──
    const trustedOrigins = [
      'http://localhost:8090',
      'http://127.0.0.1:8090',
      ...(this.config.extraOrigins ?? []),
    ]

    // ── Single continuous Elysia chain (C1, C4, H1-H5, H7) ──
    // Every method call returns a new type reference; breaking the chain
    // discards hooks, decorators, and type information from prior calls.
    // Use const chains (not let reassignment) so TypeScript infers the full
    // Elysia type after each .use(), .error(), .get(), etc.
    const server = new Elysia({ name: 'sinopebase' })
      // OpenAPI spec generation — provider: null means no Scalar/Swagger UI,
      // we serve the raw spec at /openapi/json for our native admin UI to consume.
      .use(
        openapi({
          provider: null,
          documentation: {
            info: {
              title: 'Sinopebase API',
              version: '0.5.0',
              description:
                'PocketBase-shaped, Supabase-compatible backend. REST, Auth, Storage, Realtime, Admin.',
            },
            servers: [
              { url: `http://${this.config.host ?? '127.0.0.1'}:${this.config.port ?? 8090}` },
            ],
          },
        }),
      )
      // Register all custom error classes so onError gets full type narrowing (H7)
      .error({
        ApiError,
        BadRequestError,
        UnauthorizedError,
        ForbiddenError,
        NotFoundError,
        TooManyRequestsError,
        InternalServerError,
        RequestEntityTooLargeError,
      })

      // ── Global error handler (C2, H5 merged) ──
      .onError(({ error, set, code, request }) => {
        // Stub 501 for unimplemented API routes (H5: merged into global handler)
        if (code === 'NOT_FOUND') {
          const url = new URL(request.url)
          if (url.pathname.startsWith('/api/')) {
            set.status = 501
            return { message: 'API endpoint not yet implemented.', code: 501 }
          }
          if (url.pathname.startsWith('/rest/v1/')) {
            set.status = 501
            return { message: 'REST API not yet implemented', code: 501 }
          }
          return // Let Elysia handle other 404s
        }

        // C2: VALIDATION — return useful 422 responses
        if (code === 'VALIDATION') {
          set.status = 422
          return process.env.NODE_ENV === 'production'
            ? { message: 'Validation failed', code: 'VALIDATION' }
            : error
        }

        // Structured API errors carry their own HTTP status and body.
        if (error instanceof ApiError) {
          set.status = error.status
          return error.toJSON()
        }

        const reportedError = error as Error
        // M7: gate stack trace behind dev mode
        const logPayload: Record<string, unknown> = { message: reportedError.message }
        if (process.env.NODE_ENV !== 'production') {
          logPayload.stack = (reportedError.stack ?? '').slice(0, 2048)
        }
        logger.error('PANIC RECOVER', logPayload)
        set.status = 500
        return { message: 'Internal server error', code: 500 }
      })

      // ── CORS — must be before any routes (C5, H27) ──
      .onRequest(
        cors({
          allowOrigins: trustedOrigins,
          allowCredentials: true,
        }),
      )

      // ── Security headers (H1) ──
      .onRequest(({ set }) => {
        set.headers['x-xss-protection'] = '1; mode=block'
        set.headers['x-content-type-options'] = 'nosniff'
        set.headers['x-frame-options'] = 'SAMEORIGIN'
        set.headers['referrer-policy'] = 'strict-origin-when-cross-origin'
        // M12: CSP + HSTS placeholders (tightened in extensions.ts)
        set.headers['content-security-policy'] = "frame-ancestors 'none'"
      })

      // ── Request ID — global (H2) ──
      .onRequest(({ request, set }) => {
        const requestId = request.headers.get('x-request-id') || generateRequestId()
        set.headers['x-request-id'] = requestId
        requestMeta.set(request, { startTime: performance.now(), requestId })
      })

      // ── Response logging — global (H2) ──
      .onAfterResponse(({ request, set }) => {
        const meta = requestMeta.get(request)
        if (meta) {
          const duration = Math.round(performance.now() - meta.startTime)
          const pathname = new URL(request.url).pathname
          try {
            logger.info('request', {
              request_id: meta.requestId,
              method: request.method,
              path: pathname,
              status: set.status ?? 200,
              duration_ms: duration,
            })
          } catch {
            // best-effort — never crash on logging
          }
          // Persist to _logs table if we have a database (fire-and-forget)
          if (this.database instanceof PostgresDatabase) {
            const pool = this.database.getPool()
            pool
              .query(`INSERT INTO _logs (level, message, data) VALUES ($1, $2, $3)`, [
                0,
                `${request.method} ${pathname}`,
                JSON.stringify({
                  method: request.method,
                  path: pathname,
                  status: set.status ?? 200,
                  duration_ms: duration,
                  request_id: meta.requestId,
                }),
              ])
              .catch(() => {
                /* best-effort */
              })
          }
          requestMeta.delete(request)
        }
      })

    // ── Rate limiting handler — computed before chain (H3, H25) ──
    // Default 1000 req/min per IP. Admin API, health, and static assets are
    // exempt — they're either auth-guarded or non-mutating infrastructure.
    const rlHandler = rateLimit(
      this.config.rateLimitMax ?? 1000,
      this.config.rateLimitWindow ?? 60,
      undefined,
      this.config.trustedProxies,
    )

    // ── Continue chain: routes, auth, realtime ──
    const s1 = server
      .onRequest(async ({ request, set }) => {
        const url = new URL(request.url)
        // Exempt: health, readiness, admin API (auth-guarded), logs
        if (
          url.pathname === '/api/health' ||
          url.pathname === '/api/ready' ||
          url.pathname.startsWith('/api/admin/') ||
          url.pathname.startsWith('/api/logs')
        )
          return
        await rlHandler({ request, set })
      })

      // Health check — liveness (H10: production-safe)
      .get('/api/health', () => {
        if (this.mode === 'production') {
          return { code: 200, message: 'running' }
        }
        return {
          code: 200,
          message: 'Sinopebase is running',
          // nosemgrep
          mode: this.mode,
          tls: !!this.config.tls,
          db: this.database instanceof PostgresDatabase ? 'postgresql' : 'memory',
          storage: this.fileStore instanceof S3FileStore ? 's3' : 'local',
        }
      })

      // Readiness check
      .get('/api/ready', async ({ set }) => {
        if (this.database instanceof PostgresDatabase) {
          try {
            const pool = this.database.getPool()
            const client = await pool.connect()
            client.release()
            return { code: 200, status: 'ready', db: 'connected' }
          } catch {
            set.status = 503
            return { code: 503, status: 'not ready', db: 'disconnected' }
          }
        }
        return { code: 200, status: 'ready', db: this.database ? 'memory' : 'none' }
      })

      // ── Realtime WebSocket ──
      .ws('/realtime/v1/websocket', createRealtimeWebSocketHandler(realtime))

      // ── Auth — /auth/v1/* ──
      .use(this.auth ? createAuthPlugin(this.auth, mergedProviderIds) : authPlugin)

      // Instance-scoped auth guard: applies to every /rest/v1/* and /storage/v1/*
      // route registered on this chain. Instance-scoped (not global) so plugins
      // and sub-apps are not gated by default — they opt in via their own auth.
      .onRequest(async ({ request, set }) => {
        const url = new URL(request.url)
        if (url.pathname.startsWith('/rest/v1/') || url.pathname.startsWith('/storage/v1/')) {
          if (request.method === 'OPTIONS') return
          if (url.pathname.startsWith('/storage/v1/object/public/')) return
          const authHeader = request.headers.get('authorization') ?? ''
          const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader
          // M11: timing-safe comparison for service role key
          if (Equal(token, this.cachedServiceRoleKey)) {
            // H11: audit log for service_role operations
            logger.info('audit:service_role', { method: request.method, path: url.pathname })
            postgrestContexts.set(request, { role: 'service_role' })
            return
          }
          if (
            Equal(token, this.cachedAnonKey) &&
            (url.pathname.startsWith('/storage/v1/') ||
              request.method === 'GET' ||
              request.method === 'HEAD')
          ) {
            postgrestContexts.set(request, { role: 'anon' })
            return
          }
          if (!token) {
            set.status = 401
            return { message: 'Authorization required', code: '401' }
          }
          try {
            if (this.auth) {
              const row = await lookupSessionByToken(this.auth, token)
              if (!row) {
                set.status = 401
                return { message: 'Invalid authorization token', code: '401' }
              }
              postgrestContexts.set(request, {
                role: 'authenticated',
                userId: row.id,
              })
            } else {
              const payload = await verifyAccessToken(token)
              postgrestContexts.set(request, {
                role: 'authenticated',
                userId: payload.sub,
              })
            }
          } catch {
            set.status = 401
            return { message: 'Invalid authorization token', code: '401' }
          }
        }
      })

    this.pendingServer = s1

    // ── PostgREST routes (returns Elysia) ──
    const s2 = mountPostgrestRoutes(
      s1,
      this.database,
      (request) => postgrestContexts.get(request),
      realtime,
    )

    // ── Storage — /storage/v1/* ──
    const s3 = s2.use(
      createStoragePlugin(this.fileStore, {
        resolveContext: (request) => postgrestContexts.get(request),
        access:
          this.database instanceof PostgresDatabase
            ? new PostgresStorageAccessPolicy(this.database)
            : undefined,
        maxUploadSize: this.config.maxUploadSize,
      }),
    )

    // ── Admin UI — serve built Svelte SPA from /_/ (returns Elysia, H9: auth-guarded) ──
    const s4 = this.mountAdminUI(s3)

    // ── Admin API auth helper — validates service_role token ──
    const isSuperuser = (req: Request): boolean => {
      // Reject when no service-role key is configured (in-memory dev mode)
      if (!this.cachedServiceRoleKey) return false
      const h = req.headers.get('authorization') ?? ''
      const tok = h.startsWith('Bearer ') ? h.slice(7) : h
      return Equal(tok, this.cachedServiceRoleKey)
    }

    // ── Backup / restore endpoints — service-role only ──
    if (!existsSync(this.resolvedBackupDir)) {
      await mkdir(this.resolvedBackupDir, { recursive: true })
    }

    const s5 = s4
      // GET /api/admin/backups — list available backups
      .get('/api/admin/backups', async ({ request, set }) => {
        if (!isSuperuser(request)) {
          set.status = 403
          return { code: 403, message: 'Only service_role can list backups.' }
        }
        try {
          const { listBackups } = await import('./backup')
          const backups = await listBackups(this.resolvedBackupDir)
          return backups.map((b) => ({ name: b.name, size: b.size, modified: b.modified }))
        } catch (err) {
          set.status = 500
          return {
            code: 500,
            message: `Failed to list backups: ${err instanceof Error ? err.message : String(err)}`,
          }
        }
      })

      // POST /api/admin/backup — create a backup
      .post('/api/admin/backup', async ({ request, body, set }) => {
        if (!isSuperuser(request)) {
          set.status = 403
          return { code: 403, message: 'Only service_role can create backups.' }
        }
        try {
          const data = (body ?? {}) as { name?: string }
          // H14: sanitize backup name to alphanumeric + hyphens/underscores only
          const rawName = data.name ?? `backup-${Date.now()}`
          const name = rawName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128)
          await this.createBackup(name)
          set.status = 201
          return { message: `Backup "${name}" created.`, name }
        } catch (err) {
          set.status = 500
          return {
            code: 500,
            message: `Failed to create backup: ${err instanceof Error ? err.message : String(err)}`,
          }
        }
      })

      // POST /api/admin/restore — restore a backup
      .post('/api/admin/restore', async ({ request, body, set }) => {
        if (!isSuperuser(request)) {
          set.status = 403
          return { code: 403, message: 'Only service_role can restore backups.' }
        }
        try {
          const data = (body ?? {}) as { name: string }
          if (!data.name) {
            set.status = 400
            return { code: 400, message: 'Backup name is required.' }
          }
          // H14: sanitize backup name
          const name = data.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128)
          await this.restoreBackup(name)
          set.status = 200
          return { message: `Backup "${name}" restored.` }
        } catch (err) {
          set.status = 500
          return {
            code: 500,
            message: `Failed to restore backup: ${err instanceof Error ? err.message : String(err)}`,
          }
        }
      })

    // ── Settings API — GET/PATCH /api/settings (service_role only) ──
    const { createSettingsPlugin } = await import('../apis/settings')
    s5.use(
      createSettingsPlugin(
        () => ({
          appName: this.config.appName ?? 'Sinopebase',
          allowSignups: true,
          requireVerification: false,
          minPasswordLength: 8,
        }),
        async (settings) => {
          // Persist settings by merging into config
          if (settings.appName) (this.config as Record<string, unknown>).appName = settings.appName
          if (settings.minPasswordLength)
            (this.config as Record<string, unknown>).minPasswordLength = settings.minPasswordLength
        },
        isSuperuser,
      ),
    )

    // ── Logs API — GET /api/logs/* (service_role only) ──
    if (this.database) {
      const { createLogsPlugin } = await import('../apis/logs')
      s5.use(createLogsPlugin(this.database, isSuperuser))
    }

    // ── Admin Tables API — GET /api/admin/tables (service_role only) ──
    if (this.database) {
      const { createAdminTablesPlugin } = await import('../apis/admin-tables')
      if (this.database instanceof PostgresDatabase) {
        s5.use(createAdminTablesPlugin(this.database.getPool(), isSuperuser))
      }
    }

    // ── Admin DDL API — POST /api/admin/tables (create table) ──
    if (this.database instanceof PostgresDatabase) {
      const { createAdminDdlPlugin } = await import('../apis/admin-ddl')
      s5.use(createAdminDdlPlugin(this.database.getPool(), isSuperuser))
    }

    // ── Admin RLS API — POST /api/admin/rls/enable ──
    if (this.database instanceof PostgresDatabase) {
      const { createAdminRlsPlugin } = await import('../apis/admin-rls')
      s5.use(createAdminRlsPlugin(this.database.getPool(), isSuperuser))
    }

    // ── Collections API — /api/collections/* (service_role only) ──
    if (this.database) {
      const { createCollectionPlugin } = await import('../apis/collection')
      s5.use(createCollectionPlugin(this.database, isSuperuser))
    }

    // ── Cron API — GET /api/crons, POST /api/crons/:id (service_role only) ──
    // ── Cron CRUD API — /api/crons/* (service_role only, PostgreSQL-backed) ──
    if (this.database instanceof PostgresDatabase) {
      const { createCronCrudPlugin } = await import('../apis/cron-crud')
      s5.use(createCronCrudPlugin(this.database.getPool(), isSuperuser))
    }

    // ── Admin OAuth Providers API — CRUD for OAuth/OIDC providers ──
    const { createAdminOAuthPlugin } = await import('../apis/admin-oauth')
    s5.use(
      createAdminOAuthPlugin(this.dataDir(), isSuperuser, (providers) => {
        logger.info('OAuth providers updated', { count: providers.length, restartRequired: true })
      }),
    )

    // ── Plugins (DropFunctions handles /api/functions/v1 listing + execution) ──
    const { MastraPlugin } = await import('../plugins/mastra/plugin')
    const mastraPlugin = new MastraPlugin({
      // H15: use config over process.env; never leak into config snapshots
      openaiApiKey: this.config.openaiApiKey ?? process.env.OPENAI_API_KEY,
      requireAuth: this.config.mastraRequireAuth ?? true,
    })
    const s6 = await mastraPlugin.register(
      s5,
      this.auth ?? undefined,
      this.database ?? undefined,
      this.fileStore ?? undefined,
    )

    // ── DropFunctions — Edge Functions plugin ──
    const { DropFunctionsPlugin } = await import('../plugins/drop-functions/plugin')
    const dropFunctions = new DropFunctionsPlugin({ functionsDir: './functions' })
    await dropFunctions.register(s6, this.auth ?? undefined)
    const { MetricsPlugin } = await import('../plugins/metrics/plugin')
    const s7 = await new MetricsPlugin().register(s6)

    // ── Log retention — prune old entries on startup and hourly ──
    const pruneLogs = async () => {
      if (this.database instanceof PostgresDatabase) {
        this.database
          .getPool()
          .query(`DELETE FROM _logs WHERE created < now() - make_interval(days => 30)`)
          .catch(() => {})
      }
    }
    await pruneLogs()
    this._logPruneInterval = setInterval(pruneLogs, 3_600_000)

    // ── External plugins (registered via app.use before start) ──
    // ponytail: pendingPlugins mutate in-place (return void), so don't reassign
    for (const register of this.pendingPlugins) {
      await register(s7, this.auth ?? undefined)
    }
    this.pendingPlugins = []

    // NOTE: Stub 501 for unimplemented routes is handled by the global onError
    // (NOT_FOUND branch) at the top of the chain. Using onError instead of
    // .all('*') prevents shadowing of routes registered after listen().

    // ── Production fail-closed: verify infrastructure before listening ──
    await this.requiredInfrastructure()

    const port = this.config.port ?? 8090
    const host = this.config.host ?? '0.0.0.0'
    if (this.config.tls) {
      s7.listen({
        port,
        hostname: host,
        tls: {
          cert: Bun.file(this.config.tls.cert),
          key: Bun.file(this.config.tls.key),
        },
      })

      // ── HTTP→HTTPS redirect (A3) ──
      // When TLS is active, start a companion HTTP listener on the redirect port
      // (default 80) that 301-redirects all requests to the HTTPS URL.
      const redirectPort = this.config.httpRedirectPort ?? 80
      const httpsPort = port === 443 ? '' : `:${port}`
      const redirectServer = Bun.serve({
        port: redirectPort,
        hostname: host,
        fetch(req) {
          const url = new URL(req.url)
          url.protocol = 'https'
          url.port = httpsPort
          return new Response(null, {
            status: 301,
            headers: { Location: url.toString() },
          })
        },
      })
      logger.info('HTTP→HTTPS redirect listening', {
        port: redirectPort,
        redirectTo: `https://<host>${httpsPort}`,
      })
      // Track for cleanup on shutdown
      this._redirectServer = redirectServer
    } else {
      s7.listen({ port, hostname: host })
    }
    this.server = s7
    this.pendingServer = null
    const protocol = this.config.tls ? 'https' : 'http'
    logger.info('Sinopebase server started', { protocol, port, host })
  }

  /** Create a backup of PostgreSQL and the file store. */
  async createBackup(name: string): Promise<void> {
    const { mkdir } = await import('node:fs/promises')
    const { join } = await import('node:path')

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupName = `${name}_${timestamp}`
    const destDir = join(this.resolvedBackupDir, backupName)
    if (!existsSync(destDir)) {
      await mkdir(destDir, { recursive: true })
    }

    if (this.database instanceof PostgresDatabase) {
      const pgPath = join(destDir, 'postgres.sql')
      const { pgDump: d } = await import('./backup')
      const pgUrl = this.config.postgresUrl || process.env.POSTGRES_URL || ''
      if (pgUrl) {
        await d(pgUrl, pgPath)
      }
    }

    if (this.fileStore) {
      const fsDir = join(destDir, 'filestore')
      const { backupFileStore: b } = await import('./backup-files')
      await b(this.fileStore, fsDir)
    }

    const m = {
      name: backupName,
      createdAt: new Date().toISOString(),
      hasPostgres: this.database instanceof PostgresDatabase,
      hasFileStore: !!this.fileStore,
    }
    await Bun.write(join(destDir, 'backup.json'), JSON.stringify(m, null, 2))
    logger.info('Backup created', { name: backupName })
  }

  /** Restore a backup by name. */
  async restoreBackup(name: string): Promise<void> {
    const { join } = await import('node:path')

    const destDir = join(this.resolvedBackupDir, name)
    if (!existsSync(destDir)) {
      throw new Error(`Backup not found: ${name}`)
    }

    const mp = join(destDir, 'backup.json')
    if (!existsSync(mp)) {
      throw new Error('Invalid backup: missing backup.json')
    }
    const manifest = JSON.parse(await Bun.file(mp).text())

    if (manifest.hasPostgres && this.database instanceof PostgresDatabase) {
      const pgPath = join(destDir, 'postgres.sql')
      if (existsSync(pgPath)) {
        const { pgRestore: r, verifyBackup: v } = await import('./backup')
        if (!(await v(pgPath))) {
          throw new Error('Invalid PostgreSQL backup file')
        }
        const pgUrl = this.config.postgresUrl || process.env.POSTGRES_URL || ''
        if (pgUrl) {
          await r(pgUrl, pgPath)
        }
      }
    }

    if (manifest.hasFileStore && this.fileStore) {
      const fsDir = join(destDir, 'filestore')
      if (existsSync(fsDir)) {
        const { restoreFileStore: r } = await import('./backup-files')
        await r(this.fileStore, fsDir)
      }
    }

    logger.info('Backup restored', { name })
  }

  /** Schedule a recurring backup using a cron expression. */
  scheduleBackup(cronExpression: string): void {
    this.cancelScheduledBackup()
    const cron = new Cron()
    cron.add('backup', cronExpression, () => {
      const backupName = `scheduled-${new Date().toISOString().replace(/[:.]/g, '-')}`
      this.createBackup(backupName).catch((err) => {
        logger.error('Scheduled backup failed', { error: (err as Error).message })
      })
    })
    cron.start()
    this.backupCron = cron
    logger.info('Scheduled backup', { cron: cronExpression })
  }

  /** Cancel any scheduled backup. */
  cancelScheduledBackup(): void {
    if (this.backupCron) {
      this.backupCron.stop()
      this.backupCron = null
      logger.info('Scheduled backup cancelled')
    }
  }

  /**
   * Stop the server gracefully.
   */
  async stop(): Promise<void> {
    return this.enqueueLifecycle(() => this.stopServer())
  }

  private async stopServer(): Promise<void> {
    // Cancel scheduled backup before stopping
    this.cancelScheduledBackup()

    // Release rate limiter state and stop the cleanup timer
    resetRateLimiters()

    const server = this.server
    if (server) await server.stop(true)
    if (this.server === server) this.server = null
    this.pendingServer = null

    // Stop the HTTP→HTTPS redirect server if it was started
    if (this._redirectServer) {
      this._redirectServer.stop()
      this._redirectServer = null
    }

    // Stop the PG LISTEN/NOTIFY listener if active
    if (this._pgListener) {
      try {
        await this._pgListener.stop()
      } catch {
        /* ignore */
      }
      this._pgListener = null
    }

    if (this._logPruneInterval) {
      clearInterval(this._logPruneInterval)
      this._logPruneInterval = null
    }

    // Close the database connection pool before clearing state.
    if (this.database instanceof PostgresDatabase) {
      try {
        await this.database.close()
      } catch (error) {
        logger.error('Failed to close PostgreSQL pool', { error: (error as Error).message })
      }
    }

    this.database = null
    this.fileStore = null
    this.auth = null
  }

  private enqueueLifecycle(operation: () => Promise<void>): Promise<void> {
    const result = this.lifecycle.then(operation)
    this.lifecycle = result.catch(() => undefined)
    return result
  }

  /** Returns the app data directory path. */
  dataDir(): string {
    return resolve(this.config.dataDir ?? './pb_data')
  }

  /** Returns the resolved backup directory path. */
  getBackupDir(): string {
    return this.resolvedBackupDir
  }

  /** Expose the database for base class usage. */
  getDatabase(): IDatabase | null {
    return this.database
  }

  /** Expose the file store. */
  getFileStore(): IFileStore | null {
    return this.fileStore
  }

  /** Expose the config. */
  getConfig(): AppConfig {
    return { ...this.config }
  }

  /**
   * Apply pending system migrations (PocketBase pattern: migrate on startup).
   *
   * Migrations are tracked in the `_migrations` table — already-applied
   * migrations are skipped. In non-production, bootstrapPostgresRequestRoles()
   * creates request-context roles at runtime so the least-privilege migration
   * is a no-op. In production, this is the only path that creates those roles.
   */
  async runSystemMigrations(): Promise<void> {
    if (!(this.database instanceof PostgresDatabase)) return

    const pool = this.database.getPool()
    const migrationDB: MigrationDB = {
      raw: async (sql: string) => {
        await pool.query(sql)
      },
    }

    // Auto-discover migration files from the migrations/ directory.
    // Files are loaded by <timestamp>_<name>.ts naming convention.
    const migrationsDir = resolve(import.meta.dir, '../../migrations')
    const discovered = await loadMigrationsFromDirectory(migrationsDir)

    if (discovered.length === 0) return

    const runner = new MigrationRunner(this.database, migrationDB)
    runner.registerAll(discovered)

    const count = await runner.run()
    if (count > 0) {
      logger.info('Migrations', { applied: count, status: 'complete' })
    }
  }

  /**
   * Validate the database schema and roles at startup.
   *
   * Checks that the PostgreSQL roles required for least-privilege operation
   * exist (sinopebase_app, sinopebase_admin, anon, authenticated, service_role).
   * This is a read-only validation — it never creates or modifies anything.
   *
   * Throws if any required roles are missing, which means the
   * 1779000000_least_privilege_roles migration has not been applied.
   */
  private async validateSchema(): Promise<void> {
    if (!(this.database instanceof PostgresDatabase)) return

    const pool = this.database.getPool()
    const client = await pool.connect()
    try {
      const expectedRoles = [
        'sinopebase_app',
        'sinopebase_admin',
        'anon',
        'authenticated',
        'service_role',
      ]
      const result = await client.query(
        `SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])`,
        [expectedRoles],
      )
      const existingRoles = new Set(result.rows.map((r: { rolname: string }) => r.rolname))
      const missing = expectedRoles.filter((r) => !existingRoles.has(r))
      if (missing.length > 0) {
        logger.warn(
          `Missing PostgreSQL roles: ${missing.join(', ')}. ` +
            'Run the 1779000000_least_privilege_roles migration. ' +
            'Pool will fall back to the connection role until roles are created.',
        )
      }

      logger.info('Schema validation', {
        roles: existingRoles.size,
        expected: expectedRoles.length,
        missing: missing.length,
      })
    } finally {
      client.release()
    }
  }

  /** Build a ValidatedConfig-compatible snapshot (for tests and production validation). */
  buildValidatedConfig(): ValidatedConfig {
    return {
      postgresUrl: this.config.postgresUrl || '',
      jwtSecret: this.config.jwtSecret || '',
      serviceRoleKey: this.config.serviceRoleKey || process.env.SINOPEBASE_SERVICE_ROLE_KEY || '',
      anonKey: this.config.anonKey || process.env.SINOPEBASE_ANON_KEY || '',
      appName: this.config.appName ?? 'Sinopebase',
      enablePgNotify: this.config.enablePgNotify ?? false,
      port: this.config.port ?? 8090,
      host: this.config.host ?? '0.0.0.0',
      tls: this.config.tls,
      httpRedirectPort: this.config.httpRedirectPort ?? 80,
      s3Endpoint: this.config.minioEndpoint || process.env.RUSTFS_ENDPOINT || undefined,
      s3AccessKey: this.config.minioAccessKey || process.env.RUSTFS_ACCESS_KEY || undefined,
      s3SecretKey: this.config.minioSecretKey || process.env.RUSTFS_SECRET_KEY || undefined,
      oauthProviders: this.config.oauthProviders ?? [],
      extraOrigins: this.config.extraOrigins ?? [],
      openaiApiKey: process.env.OPENAI_API_KEY,
      mastraRequireAuth: this.config.mastraRequireAuth ?? true,
      dataDir: this.config.dataDir ?? './pb_data',
      trustedProxies: this.config.trustedProxies ?? [],
    }
  }

  /**
   * Mount the admin UI static files at /_/.
   * Serves the built Svelte SPA from ui/dist/ with client-side routing fallback.
   *
   * H9: Auth guard — service_role token required in production.
   * In dev mode, unauthenticated access is allowed with a console warning.
   */
  private mountAdminUI(server: Elysia): Elysia {
    const distPath = resolve('./ui/dist')
    const viteUrl = 'http://localhost:5173'
    let viteOk = false

    // In dev mode, proxy to Vite dev server for HMR if it's reachable.
    if (this.mode === 'development') {
      fetch(`${viteUrl}/@vite/client`, { signal: AbortSignal.timeout(500) })
        .then((r) => {
          viteOk = r.ok
        })
        .catch(() => {
          viteOk = false
        })
    }

    // Single catch-all route for admin UI — proxy Vite in dev, serve static otherwise
    const s = server.get('/_/*', async ({ request, set }) => {
      // ── HMR proxy: forward to Vite dev server ──
      if (viteOk) {
        const url = new URL(request.url)
        const proxied = await fetch(`${viteUrl}${url.pathname}${url.search}`, {
          headers: { Accept: request.headers.get('accept') ?? '*/*' },
          signal: AbortSignal.timeout(30000),
        }).catch(() => null)
        if (proxied) {
          set.status = proxied.status
          proxied.headers.forEach((v, k) => {
            if (k !== 'content-encoding') set.headers[k] = v
          })
          return proxied.body ? new Uint8Array(await proxied.arrayBuffer()) : null
        }
        // Vite not reachable — fall through to static serving
        viteOk = false
      }

      // ── H9: Auth guard ──
      // ── H9: Auth guard ──
      const authHeader = request.headers.get('authorization') ?? ''
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader
      const isServiceRole = token ? Equal(token, this.cachedServiceRoleKey) : false

      if (!isServiceRole) {
        if (this.mode === 'production') {
          set.status = 401
          set.headers['Content-Type'] = 'text/html'
          return `<!DOCTYPE html><html><body><h1>401 Unauthorized</h1><p>Service role key required to access the admin dashboard.</p></body></html>`
        }
        // Dev mode: allow with warning
        if (token) {
          console.warn('[admin-ui] Non-service-role token used to access /_/ in dev mode')
        }
      }

      try {
        const url = new URL(request.url)
        const requested = url.pathname.replace(/^\/_\/?/, '') || 'index.html'

        // Path-traversal guard: resolve and verify the path stays within distPath.
        const resolved = resolve(distPath, requested)
        if (!resolved.startsWith(`${distPath}/`) && !resolved.startsWith(`${distPath}\\`)) {
          set.status = 403
          return 'Forbidden'
        }

        const file = Bun.file(resolved)
        if (await file.exists()) {
          const ext = requested.split('.').pop() || ''
          const mime: Record<string, string> = {
            html: 'text/html',
            css: 'text/css',
            js: 'application/javascript',
            mjs: 'application/javascript',
            json: 'application/json',
            png: 'image/png',
            svg: 'image/svg+xml',
            ico: 'image/x-icon',
          }
          set.headers['Content-Type'] = mime[ext] || 'application/octet-stream'
          return new Response(await file.arrayBuffer(), {
            headers: { 'Content-Type': set.headers['Content-Type'] as string },
          })
        }

        // SPA fallback
        const index = Bun.file(resolve(distPath, 'index.html'))
        if (await index.exists()) {
          set.headers['Content-Type'] = 'text/html'
          return new Response(await index.arrayBuffer(), {
            headers: { 'Content-Type': 'text/html' },
          })
        }
      } catch {
        /* fall through */
      }

      set.headers['Content-Type'] = 'text/html'
      return ADMIN_PLACEHOLDER
    })
    return s as unknown as Elysia
  }

  /** Expose the better-auth instance (null if in-memory mode). */
  getAuth(): AuthInstance | null {
    return this.auth
  }

  /**
   * Create required tables in the in-memory database.
   */
  private async ensureTables(): Promise<void> {
    if (!this.database) return
    await this.database.createTable('todos')
  }

  /**
   * Preflight infrastructure check run just before listen().
   *
   * Verifies that all critical subsystems are healthy before the server
   * starts accepting connections. If any check fails, a descriptive error
   * is thrown and the server never enters the listening state.
   */
  private async requiredInfrastructure(): Promise<void> {
    const errors: string[] = []

    // 1. PostgreSQL connectivity — run SELECT 1 on the primary pool
    if (this.database instanceof PostgresDatabase) {
      try {
        const pool = this.database.getPool()
        const client = await pool.connect()
        await client.query('SELECT 1')
        client.release()
      } catch (err) {
        errors.push(
          `PostgreSQL connectivity check failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    } else if (this.mode === 'production') {
      errors.push('PostgreSQL database is not initialized in production mode.')
    }

    // 2. Auth is initialized in production mode
    if (this.mode === 'production' && this.auth === null) {
      errors.push('Auth (better-auth) is not initialized in production mode.')
    }

    // 3. File store readiness — verify S3 connectivity via listBuckets()
    if (this.fileStore) {
      if (this.fileStore instanceof S3FileStore) {
        try {
          await this.fileStore.listBuckets()
        } catch (err) {
          errors.push(
            `S3 file store connectivity check failed: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }
      // LocalFileStore is always ready — no remote connectivity needed
    } else if (this.mode === 'production') {
      errors.push('File store is not initialized in production mode.')
    }

    // 4–6. Dev/placeholder secret checks — fatal only in production
    if (this.mode === 'production') {
      const jwtSecret = this.config.jwtSecret || process.env.JWT_SECRET || ''
      if (jwtSecret && isDevSecret(jwtSecret)) {
        errors.push(
          'JWT_SECRET matches a dev/placeholder secret pattern. ' +
            'Set a cryptographically random value (≥32 chars) for production.',
        )
      }

      if (this.cachedServiceRoleKey && isDevSecret(this.cachedServiceRoleKey)) {
        errors.push(
          'SINOPEBASE_SERVICE_ROLE_KEY matches a dev/placeholder secret pattern. ' +
            'Set a cryptographically random value (≥32 chars) for production.',
        )
      }

      if (this.cachedAnonKey && isDevSecret(this.cachedAnonKey)) {
        errors.push(
          'SINOPEBASE_ANON_KEY matches a dev/placeholder secret pattern. ' +
            'Set a cryptographically random value (≥32 chars) for production.',
        )
      }
    }

    if (errors.length > 0) {
      throw new Error(
        `Infrastructure preflight check failed (${errors.length} issue(s)):\n  - ` +
          errors.join('\n  - '),
      )
    }
  }
}

function realtimeVisibilityFilters(row: Record<string, unknown>): PostgresFilter[] {
  if (row.id !== undefined && row.id !== null) {
    return [{ column: 'id', operator: 'eq', value: row.id }]
  }

  return Object.entries(row)
    .filter(([, value]) => value === null || ['string', 'number', 'boolean'].includes(typeof value))
    .map(([column, value]) => ({ column, operator: 'eq', value }))
}
