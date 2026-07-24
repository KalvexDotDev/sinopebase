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
import type { IDatabase } from './db-interface'
import type {
  BootstrapEvent,
  ServeEvent,
  TerminateEvent,
  BackupEvent,
  ModelEvent,
  ModelErrorEvent,
  RecordEvent,
  RecordErrorEvent,
  RecordEnrichEvent,
  CollectionEvent,
  CollectionErrorEvent,
  MailerEvent,
  MailerRecordEvent,
  RealtimeConnectEvent,
  RealtimeMessageEvent,
  RealtimeSubscribeEvent,
  SettingsListEvent,
  SettingsUpdateEvent,
  SettingsReloadEvent,
  RecordsListEvent,
  RecordViewEvent,
  RecordCreateEvent,
  RecordUpdateEvent,
  RecordDeleteEvent,
  RecordAuthEvent,
  RecordAuthWithPasswordEvent,
  RecordAuthWithOAuth2Event,
  RecordAuthRefreshEvent,
  RecordRequestPasswordResetEvent,
  RecordConfirmPasswordResetEvent,
  RecordRequestVerificationEvent,
  RecordConfirmVerificationEvent,
  RecordRequestEmailChangeEvent,
  RecordConfirmEmailChangeEvent,
  RecordCreateOTPRequestEvent,
  RecordAuthWithOTPRequestEvent,
  CollectionsListEvent,
  CollectionRequestEvent,
  CollectionCreateEvent,
  CollectionUpdateEvent,
  CollectionDeleteEvent,
  CollectionsImportRequestEvent,
  FileTokenRequestEvent,
  FileDownloadRequestEvent,
  BatchRequestEvent,
} from './events'
import type { Model } from './db_model'

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
  findAllRecords(
    collectionModelOrIdentifier: unknown,
    ...exprs: unknown[]
  ): Promise<unknown[]>

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
  countRecords(
    collectionModelOrIdentifier: unknown,
    ...exprs: unknown[]
  ): Promise<number>

  /** FindAuthRecordByToken finds the auth record associated with a JWT. */
  findAuthRecordByToken(
    token: string,
    ...validTypes: string[]
  ): Promise<unknown>

  /** FindAuthRecordByEmail finds the auth record by email. */
  findAuthRecordByEmail(
    collectionModelOrIdentifier: unknown,
    email: string,
  ): Promise<unknown>

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
  onRecordRequestPasswordResetRequest(...tags: string[]): TaggedHook<RecordRequestPasswordResetEvent>
  onRecordConfirmPasswordResetRequest(...tags: string[]): TaggedHook<RecordConfirmPasswordResetEvent>
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

import { Elysia } from 'elysia'
import {
  createRealtimeHub,
  createRealtimeWebSocketHandler,
} from '../apis/realtime'
import { authPlugin, createAuthPlugin } from '../apis/auth'
import { verifyAccessToken } from '../apis/auth-jwt'
import { createAuth, lookupSessionByToken } from '../tools/auth-better'
import type { IFileStore } from '../tools/filesystem/store-interface'
import { MemoryDatabaseAdapter } from './db-memory-adapter'
import {
  PostgresDatabase,
  type Filter as PostgresFilter,
  type PostgresRequestContext,
} from './db-postgres'
import { mountPostgrestRoutes } from '../apis/postgrest'
import { LocalFileStore } from '../tools/filesystem/store'
import { S3FileStore } from '../tools/filesystem/store-s3'
import { PostgresStorageAccessPolicy } from '../apis/storage-postgres'
import { createStoragePlugin } from '../apis/file'
import { type ValidatedConfig, detectMode } from './config'
import { rateLimit, resetRateLimiters } from '../apis/middlewares_rate_limit'
import { ApiError } from '../apis/api_error_aliases'
import { resolve, join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { logger, generateRequestId } from './logger'
import { Cron } from '~/tools/cron/cron'

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
  /** TLS certificate and key file paths */
  tls?: { cert: string; key: string }
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
  private database: IDatabase | null = null
  private fileStore: IFileStore | null = null
  private auth: any = null
  private lifecycle: Promise<void> = Promise.resolve()
  /** Cached secrets — validated once at startup, never read from process.env thereafter. */
  private cachedServiceRoleKey = ''
  private cachedAnonKey = ''
  private cachedJwtSecret = ''
  /**
   * Plugin registration callbacks queued via {@link use}.
   * Executed during {@link initializeServer} after core routes are registered
   * but BEFORE the server starts listening, so Elysia's route resolution
   * includes plugin routes from the first request.
   */
  private pendingPlugins: Array<(server: Elysia, auth: any) => Promise<void>> = []

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
    this.resolvedBackupDir = resolve(this.dataDir(), this.config.backupDir!)
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
  use(register: (server: Elysia, auth: any) => Promise<void>): this {
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
      process.env['JWT_SECRET'] = this.config.jwtSecret
    }

    // Set env vars from config for downstream consumers
    if (this.config.serviceRoleKey) {
      process.env['SINOPEBASE_SERVICE_ROLE_KEY'] = this.config.serviceRoleKey
    }
    if (this.config.anonKey) {
      process.env['SINOPEBASE_ANON_KEY'] = this.config.anonKey
    }

    // Production fail-closed: validate infrastructure requirements before connecting
    if (this.mode === 'production') {
      const pgUrl = this.config.postgresUrl || process.env['POSTGRES_URL'] || ''
      if (!pgUrl) {
        throw new Error(
          'Production mode requires POSTGRES_URL. ' +
          'Set NODE_ENV=development or SINOPEBASE_PRODUCTION=false to use the in-memory database.',
        )
      }
      const s3CheckEndpoint = this.config.minioEndpoint || process.env['RUSTFS_ENDPOINT'] || ''
      const s3CheckKey = this.config.minioAccessKey || process.env['RUSTFS_ACCESS_KEY'] || ''
      const s3CheckSecret = this.config.minioSecretKey || process.env['RUSTFS_SECRET_KEY'] || ''
      if (!s3CheckEndpoint || !s3CheckKey || !s3CheckSecret) {
        throw new Error(
          'Production mode requires S3/MinIO configuration. ' +
          'Set RUSTFS_ENDPOINT, RUSTFS_ACCESS_KEY, and RUSTFS_SECRET_KEY.',
        )
      }
    }

    // Initialize database: PostgreSQL or in-memory fallback
    const postgresUrl = this.config.postgresUrl || process.env['POSTGRES_URL'] || ''
    if (postgresUrl) {
      const pg = new PostgresDatabase({
        postgresUrl,
      })
      await pg.connect()
      this.database = pg
      logger.info('Database', { provider: 'PostgreSQL', status: 'connected' })

      // Fail-closed in production: refuse to start with well-known test keys
      // when PostgreSQL is configured. These keys bypass all authentication.
      // In local dev (no POSTGRES_URL) the defaults are acceptable.
      {
        const serviceKey = process.env['SINOPEBASE_SERVICE_ROLE_KEY']
        const anonKey = process.env['SINOPEBASE_ANON_KEY']
        const jwtSecret = process.env['JWT_SECRET'] || this.config.jwtSecret || ''
        const JWT_DEV_FALLBACK = 'sinopebase-dev-jwt-secret-min-32-chars!!'

        if (!serviceKey || serviceKey === 'test-service-role-key') {
          throw new Error(
            'SINOPEBASE_SERVICE_ROLE_KEY is unset or using the "test-service-role-key" default. ' +
            'Set it to a cryptographically random value (≥32 chars) before starting in production mode.',
          )
        }
        if (!anonKey || anonKey === 'test-anon-key') {
          throw new Error(
            'SINOPEBASE_ANON_KEY is unset or using the "test-anon-key" default. ' +
            'Set it to a cryptographically random value (≥32 chars) before starting in production mode.',
          )
        }
        if (!jwtSecret || jwtSecret === JWT_DEV_FALLBACK) {
          if (this.mode === 'production') {
            throw new Error(
              'JWT_SECRET is unset or using the dev fallback. ' +
              'Set it to a cryptographically random value (≥32 chars) before starting in production mode.',
            )
          }
          logger.warn('JWT_SECRET is using the dev fallback in PostgreSQL mode. Set JWT_SECRET to a cryptographically random value in production.')
        }

        // Cache validated secrets — never read from process.env per-request.
        this.cachedServiceRoleKey = serviceKey!
        this.cachedAnonKey = anonKey!
        this.cachedJwtSecret = jwtSecret || JWT_DEV_FALLBACK
        process.env['JWT_SECRET'] = this.cachedJwtSecret
        process.env['SINOPEBASE_SERVICE_ROLE_KEY'] = serviceKey!
        process.env['SINOPEBASE_ANON_KEY'] = anonKey!
      }

      // Initialize better-auth with PostgreSQL
      try {
        const pool = pg.getPool()
        this.auth = await createAuth(pool, {
        jwtSecret: this.config.jwtSecret,
        oauthProviders: this.config.oauthProviders,
        extraOrigins: this.config.extraOrigins,
      })
        logger.info('Auth', { provider: 'better-auth', backend: 'PostgreSQL', status: 'initialized' })
      } catch (err) {
        logger.warn('Auth: better-auth init failed, falling back to in-memory', { error: (err as Error).message })
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
    const s3Endpoint = this.config.minioEndpoint || process.env['RUSTFS_ENDPOINT'] || ''
    const s3AccessKey = this.config.minioAccessKey || process.env['RUSTFS_ACCESS_KEY'] || ''
    const s3SecretKey = this.config.minioSecretKey || process.env['RUSTFS_SECRET_KEY'] || ''
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
      if (token === this.cachedServiceRoleKey) return { role: 'service_role' }
      if (token === this.cachedAnonKey) return { role: 'anon' }

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

    const server = new Elysia()
    this.pendingServer = server
    server
      // ── Security middleware ──
      .onError(({ error, set, code }) => {
        // Let NOT_FOUND pass through — handled by the stub-route onError
        // (or Elysia's default 404 handler for non-API paths).
        if (code === 'NOT_FOUND') return

        // Structured API errors carry their own HTTP status and body.
        // Preserve the original status (e.g. 429 Too Many Requests)
        // instead of flattening to 500.
        if (error instanceof ApiError) {
          set.status = error.status
          return error.toJSON()
        }

        const reportedError = error as Error
        logger.error('PANIC RECOVER', { message: reportedError.message, stack: (reportedError.stack ?? '').slice(0, 2048) })
        set.status = 500
        return { message: 'Internal server error', code: '500' }
      })
      .onRequest(({ set }) => {
        set.headers['x-xss-protection'] = '1; mode=block'
        set.headers['x-content-type-options'] = 'nosniff'
        set.headers['x-frame-options'] = 'SAMEORIGIN'
        set.headers['referrer-policy'] = 'strict-origin-when-cross-origin'
      })

      // ── Request ID and response logging ──
    const requestMeta = new WeakMap<Request, { startTime: number; requestId: string }>()
    server
      .onRequest(({ request, set }) => {
        const requestId = request.headers.get('x-request-id') || generateRequestId()
        set.headers['x-request-id'] = requestId
        requestMeta.set(request, { startTime: performance.now(), requestId })
      })
      .onAfterResponse(({ request, set }) => {
        const meta = requestMeta.get(request)
        if (meta) {
          const duration = Math.round(performance.now() - meta.startTime)
          try {
            logger.info('request', {
              request_id: meta.requestId,
              method: request.method,
              path: new URL(request.url).pathname,
              status: set.status ?? 200,
              duration_ms: duration,
            })
          } catch {
            // best-effort — never crash on logging
          }
          requestMeta.delete(request)
        }
      })

      // ── Rate limiting ──
    const rlHandler = rateLimit(
      this.config.rateLimitMax ?? 100,
      this.config.rateLimitWindow ?? 60,
    )
    server.onRequest(async ({ request, set }) => {
      const url = new URL(request.url)
      if (url.pathname === '/api/health' || url.pathname === '/api/ready') return
      await rlHandler({ request, set })
    })

      // Health check (liveness — always returns 200 if the process is up)
      .get('/api/health', () => ({
        code: 200,
        message: 'Sinopebase is running',
        mode: this.mode,
        tls: !!this.config.tls,
        db: this.database instanceof PostgresDatabase ? 'postgresql' : 'memory',
        storage: this.fileStore instanceof S3FileStore ? 's3' : 'local',
      }))

      // Readiness check (reports DB connectivity)
      .get('/api/ready', async ({ set }) => {
        if (this.database instanceof PostgresDatabase) {
          try {
            const pool = this.database.getPool()
            const client = await pool.connect()
            client.release()
            return {
              code: 200,
              status: 'ready',
              db: 'connected',
            }
          } catch {
            set.status = 503
            return {
              code: 503,
              status: 'not ready',
              db: 'disconnected',
            }
          }
        }
        return {
          code: 200,
          status: 'ready',
          db: this.database ? 'memory' : 'none',
        }
      })

      // ── Realtime WebSocket ──
      .ws('/realtime/v1/websocket', createRealtimeWebSocketHandler(realtime))

      // ── Auth — /auth/v1/* ──
      .use(this.auth ? createAuthPlugin(this.auth) : authPlugin)

      // ── Auth guard for /rest/v1/* and /storage/v1/* ──
      .onRequest(async ({ request, set }) => {
        const url = new URL(request.url)
        if (url.pathname.startsWith('/rest/v1/') || url.pathname.startsWith('/storage/v1/')) {
          // Skip auth for OPTIONS preflight
          if (request.method === 'OPTIONS') return
          // Public objects are authorized by the bucket's trusted metadata,
          // not by caller-provided credentials.
          if (url.pathname.startsWith('/storage/v1/object/public/')) return
          const authHeader = request.headers.get('authorization') ?? ''
          const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader
          // Allow service role key to bypass auth (full access).
          // Keys are cached at startup — never read from process.env per-request.
          if (token === this.cachedServiceRoleKey) {
            postgrestContexts.set(request, { role: 'service_role' })
            return
          }
          // Allow anon key for read-only REST access and for storage paths
          // (where RLS policies at the DB layer enforce per-bucket permissions).
          // Keys are cached at startup — never read from process.env per-request.
          if (token === this.cachedAnonKey && (
            url.pathname.startsWith('/storage/v1/')
            || request.method === 'GET'
            || request.method === 'HEAD'
          )) {
            postgrestContexts.set(request, { role: 'anon' })
            return
          }
          if (!token) {
            set.status = 401
            return { message: 'Authorization required', code: '401' }
          }
          // Validate the token
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
              // In-memory: verify JWT signature
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

      // ── PostgREST routes ──
    mountPostgrestRoutes(
      server,
      this.database,
      (request) => postgrestContexts.get(request),
      realtime,
    )

    // ── Storage — /storage/v1/* ──
    server.use(createStoragePlugin(this.fileStore, {
      resolveContext: (request) => postgrestContexts.get(request),
      access: this.database instanceof PostgresDatabase
        ? new PostgresStorageAccessPolicy(this.database)
        : undefined,
    }))

    // ── Admin UI — serve built Svelte SPA from /_/ ──
    this.mountAdminUI(server)

    // ── Backup / restore endpoints — service-role only ──
    // Ensure backup directory exists
    if (!existsSync(this.resolvedBackupDir)) {
      await mkdir(this.resolvedBackupDir, { recursive: true })
    }

    server
      // GET /api/admin/backups — list available backups
      .get('/api/admin/backups', async ({ set, request }) => {
        const ctx = postgrestContexts.get(request)
        if (!ctx || ctx.role !== 'service_role') {
          set.status = 403
          return { code: 403, message: 'Only service_role can list backups.' }
        }
        try {
          const { listBackups } = await import('./backup')
          const backups = await listBackups(this.resolvedBackupDir)
          return backups.map((b) => ({ name: b.name, size: b.size, modified: b.modified }))
        } catch (err) {
          set.status = 500
          return { code: 500, message: `Failed to list backups: ${err instanceof Error ? err.message : String(err)}` }
        }
      })

      // POST /api/admin/backup — create a backup
      .post('/api/admin/backup', async ({ body, set, request }) => {
        const ctx = postgrestContexts.get(request)
        if (!ctx || ctx.role !== 'service_role') {
          set.status = 403
          return { code: 403, message: 'Only service_role can create backups.' }
        }
        try {
          const data = (body ?? {}) as { name?: string }
          const name = data.name ?? `backup-${Date.now()}`
          await this.createBackup(name)
          set.status = 201
          return { message: `Backup "${name}" created.`, name }
        } catch (err) {
          set.status = 500
          return { code: 500, message: `Failed to create backup: ${err instanceof Error ? err.message : String(err)}` }
        }
      })

      // POST /api/admin/restore — restore a backup
      .post('/api/admin/restore', async ({ body, set, request }) => {
        const ctx = postgrestContexts.get(request)
        if (!ctx || ctx.role !== 'service_role') {
          set.status = 403
          return { code: 403, message: 'Only service_role can restore backups.' }
        }
        try {
          const data = (body ?? {}) as { name: string }
          if (!data.name) {
            set.status = 400
            return { code: 400, message: 'Backup name is required.' }
          }
          await this.restoreBackup(data.name)
          set.status = 200
          return { message: `Backup "${data.name}" restored.` }
        } catch (err) {
          set.status = 500
          return { code: 500, message: `Failed to restore backup: ${err instanceof Error ? err.message : String(err)}` }
        }
      })

    // ── Plugins ──
    const { MastraPlugin } = await import('../plugins/mastra/plugin')
    const mastraPlugin = new MastraPlugin({ openaiApiKey: process.env['OPENAI_API_KEY'], requireAuth: this.config.mastraRequireAuth ?? true })
    await mastraPlugin.register(server, this.auth ?? undefined, this.database ?? undefined, this.fileStore ?? undefined)
    const { MetricsPlugin } = await import('../plugins/metrics/plugin')
    await new MetricsPlugin().register(server)

    // ── External plugins (registered via app.use before start) ──
    for (const register of this.pendingPlugins) {
      await register(server, this.auth ?? undefined)
    }
    this.pendingPlugins = []

    // ── Stub routes — return 501 for unimplemented API routes ──
    // Uses onError (NOT_FOUND) instead of greedy .all() wildcards so that
    // routes registered after listen() (e.g. DropFunctions plugin) are not
    // shadowed.  Elysia resolves .all('*') routes by first-registered-wins on
    // path conflicts, which would permanently hide post-listen plugin routes.
    server.onError(({ code, set, request }) => {
      if (code === 'NOT_FOUND') {
        const url = new URL(request.url)
        if (url.pathname.startsWith('/api/')) {
          set.status = 501
          return { message: 'API endpoint not yet implemented.', code: 501 }
        }
        if (url.pathname.startsWith('/rest/v1/')) {
          set.status = 501
          return { message: 'REST API not yet implemented', code: '501' }
        }
      }
      // Let other errors fall through to the general error handler below.
    })

    const port = this.config.port ?? 8090
    const host = this.config.host ?? '0.0.0.0'
    if (this.config.tls) {
      server.listen({
        port,
        hostname: host,
        tls: {
          cert: Bun.file(this.config.tls.cert),
          key: Bun.file(this.config.tls.key),
        },
      })
    } else {
      server.listen({ port, hostname: host })
    }
    this.server = server
    this.pendingServer = null
    const protocol = this.config.tls ? 'https' : 'http'
    logger.info('Sinopebase server started', { protocol, port, host })
  }

  /** Create a backup of PostgreSQL and the file store. */
  async createBackup(name: string): Promise<void> {
    const { mkdir } = await import('node:fs/promises')
    const { join } = await import('node:path')

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupName = name + '_' + timestamp
    const destDir = join(this.resolvedBackupDir, backupName)
    if (!existsSync(destDir)) { await mkdir(destDir, { recursive: true }) }

    if (this.database instanceof PostgresDatabase) {
      const pgPath = join(destDir, 'postgres.sql')
      const { pgDump: d } = await import('./backup')
      const pgUrl = this.config.postgresUrl || process.env['POSTGRES_URL'] || ''
      if (pgUrl) { await d(pgUrl, pgPath) }
    }

    if (this.fileStore) {
      const fsDir = join(destDir, 'filestore')
      const { backupFileStore: b } = await import('./backup-files')
      await b(this.fileStore, fsDir)
    }

    const m = { name: backupName, createdAt: new Date().toISOString(), hasPostgres: this.database instanceof PostgresDatabase, hasFileStore: !!this.fileStore }
    await Bun.write(join(destDir, 'backup.json'), JSON.stringify(m, null, 2))
    logger.info('Backup created', { name: backupName })
  }

  /** Restore a backup by name. */
  async restoreBackup(name: string): Promise<void> {
    const { join } = await import('node:path')

    const destDir = join(this.resolvedBackupDir, name)
    if (!existsSync(destDir)) { throw new Error('Backup not found: ' + name) }

    const mp = join(destDir, 'backup.json')
    if (!existsSync(mp)) { throw new Error('Invalid backup: missing backup.json') }
    const manifest = JSON.parse(await Bun.file(mp).text())

    if (manifest.hasPostgres && this.database instanceof PostgresDatabase) {
      const pgPath = join(destDir, 'postgres.sql')
      if (existsSync(pgPath)) {
        const { pgRestore: r, verifyBackup: v } = await import('./backup')
        if (!(await v(pgPath))) { throw new Error('Invalid PostgreSQL backup file') }
        const pgUrl = this.config.postgresUrl || process.env['POSTGRES_URL'] || ''
        if (pgUrl) { await r(pgUrl, pgPath) }
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
      const backupName = 'scheduled-' + new Date().toISOString().replace(/[:.]/g, '-')
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

  /** Build a ValidatedConfig-compatible snapshot (for tests and production validation). */
  buildValidatedConfig(): ValidatedConfig {
    return {
      postgresUrl: this.config.postgresUrl || '',
      jwtSecret: this.config.jwtSecret || '',
      serviceRoleKey:
        this.config.serviceRoleKey || process.env['SINOPEBASE_SERVICE_ROLE_KEY'] || '',
      anonKey: this.config.anonKey || process.env['SINOPEBASE_ANON_KEY'] || '',
      port: this.config.port ?? 8090,
      host: this.config.host ?? '0.0.0.0',
      tls: this.config.tls,
      s3Endpoint: this.config.minioEndpoint || process.env['RUSTFS_ENDPOINT'] || undefined,
      s3AccessKey: this.config.minioAccessKey || process.env['RUSTFS_ACCESS_KEY'] || undefined,
      s3SecretKey: this.config.minioSecretKey || process.env['RUSTFS_SECRET_KEY'] || undefined,
      oauthProviders: this.config.oauthProviders ?? [],
      extraOrigins: this.config.extraOrigins ?? [],
      openaiApiKey: process.env['OPENAI_API_KEY'],
      mastraRequireAuth: this.config.mastraRequireAuth ?? true,
      dataDir: this.config.dataDir ?? './pb_data',
      trustedProxies: this.config.trustedProxies ?? [],
    }
  }

  /**
   * Mount the admin UI static files at /_/.
   * Serves the built Svelte SPA from ui/dist/ with client-side routing fallback.
   */
  private mountAdminUI(server: Elysia): void {
    const distPath = resolve('./ui/dist')

    // Single catch-all route for admin UI — serves files or falls back to index.html
    server.get('/_/*', async ({ request, set }) => {
      try {
        const url = new URL(request.url)
        const requested = url.pathname.replace(/^\/_\/?/, '') || 'index.html'

        // Path-traversal guard: resolve and verify the path stays within distPath.
        const resolved = resolve(distPath, requested)
        if (!resolved.startsWith(distPath + '/') && !resolved.startsWith(distPath + '\\')) {
          set.status = 403; return 'Forbidden'
        }

        const file = Bun.file(resolved)
        if (await file.exists()) {
          const ext = requested.split('.').pop() || ''
          const mime: Record<string, string> = { html: 'text/html', css: 'text/css', js: 'application/javascript', mjs: 'application/javascript', json: 'application/json', png: 'image/png', svg: 'image/svg+xml', ico: 'image/x-icon' }
          set.headers['Content-Type'] = mime[ext] || 'application/octet-stream'
          return new Response(await file.arrayBuffer(), { headers: { 'Content-Type': set.headers['Content-Type'] as string } })
        }

        // SPA fallback
        const index = Bun.file(resolve(distPath, 'index.html'))
        if (await index.exists()) {
          set.headers['Content-Type'] = 'text/html'
          return new Response(await index.arrayBuffer(), { headers: { 'Content-Type': 'text/html' } })
        }
      } catch { /* fall through */ }

      set.headers['Content-Type'] = 'text/html'
      return ADMIN_PLACEHOLDER
    })
  }

  /** Expose the better-auth instance (null if in-memory mode). */
  getAuth(): any { return this.auth }

  /**
   * Create required tables in the in-memory database.
   */
  private async ensureTables(): Promise<void> {
    if (!this.database) return
    await this.database.createTable('todos')
  }
}

function realtimeVisibilityFilters(
  row: Record<string, unknown>,
): PostgresFilter[] {
  if (row['id'] !== undefined && row['id'] !== null) {
    return [{ column: 'id', operator: 'eq', value: row['id'] }]
  }

  return Object.entries(row)
    .filter(([, value]) =>
      value === null || ['string', 'number', 'boolean'].includes(typeof value)
    )
    .map(([column, value]) => ({ column, operator: 'eq', value }))
}
