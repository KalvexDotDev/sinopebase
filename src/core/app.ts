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
import { createRealtimeWebSocketHandler } from '../apis/realtime'
import { authPlugin, createAuthPlugin } from '../apis/auth'
import { verifyAccessToken } from '../apis/auth-jwt'
import { createAuth, lookupSessionByToken } from '../tools/auth-better'
import type { IFileStore } from '../tools/filesystem/store-interface'
import { MemoryDatabase } from './db-memory'
import { PostgresDatabase } from './db-postgres'
import { mountPostgrestRoutes } from '../apis/postgrest'
import { LocalFileStore } from '../tools/filesystem/store'
import { S3FileStore } from '../tools/filesystem/store-s3'
import { createStoragePlugin } from '../apis/file'

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
  private server: Elysia | null = null
  private db: IDatabase | null = null
  private fileStore: IFileStore | null = null
  private auth: any = null

  constructor(config: AppConfig) {
    this.config = {
      port: 8090,
      dataDir: './pb_data',
      postgresUrl: '',
      minioEndpoint: '',
      minioAccessKey: '',
      minioSecretKey: '',
      ...config,
    }
  }

  /**
   * Start the Sinopebase server.
   * Mirrors apis.Serve() in PocketBase.
   */
  async start(): Promise<void> {
    // Set JWT secret from config if provided
    if (this.config.jwtSecret) {
      process.env.JWT_SECRET = this.config.jwtSecret
    }

    // Initialize database: PostgreSQL or in-memory fallback
    const postgresUrl = this.config.postgresUrl || process.env.POSTGRES_URL || ''
    if (postgresUrl) {
      const pg = new PostgresDatabase({
        postgresUrl,
      })
      await pg.connect()
      this.db = pg
      console.log('Database: PostgreSQL connected')

      // Initialize better-auth with PostgreSQL
      try {
        const pool = pg.getPool()
        this.auth = await createAuth(pool, { jwtSecret: this.config.jwtSecret })
        console.log('Auth: better-auth initialized (PostgreSQL)')
      } catch (err) {
        console.warn('Auth: better-auth init failed, falling back to in-memory:', (err as Error).message)
        this.auth = null
      }
    } else {
      this.db = new MemoryDatabase()
      console.log('Database: in-memory (no POSTGRES_URL set)')
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
      console.log(`Storage: S3 (${this.config.minioEndpoint})`)
    } else {
      this.fileStore = new LocalFileStore(this.config.dataDir ?? './pb_data')
      console.log('Storage: local filesystem (no RUSTFS_ENDPOINT set)')
    }

    // Create required tables
    await this.ensureTables()

    this.server = new Elysia()
      // ── Security middleware ──
      .onError(({ error, set }) => {
        console.error('[PANIC RECOVER]', error.message, (error.stack ?? '').slice(0, 2048))
        set.status = 500
        return { message: 'Internal server error', code: '500' }
      })
      .onRequest(({ set }) => {
        set.headers['x-xss-protection'] = '1; mode=block'
        set.headers['x-content-type-options'] = 'nosniff'
        set.headers['x-frame-options'] = 'SAMEORIGIN'
        set.headers['referrer-policy'] = 'strict-origin-when-cross-origin'
      })

      // Health check
      .get('/api/health', () => ({
        code: 200,
        message: 'Sinopebase is running',
        db: this.db instanceof PostgresDatabase ? 'postgresql' : 'memory',
        storage: this.fileStore instanceof S3FileStore ? 's3' : 'local',
      }))

      // ── Realtime WebSocket ──
      .ws('/realtime/v1/websocket', createRealtimeWebSocketHandler())

      // ── Auth — /auth/v1/* ──
      .use(this.auth ? createAuthPlugin(this.auth) : authPlugin)

      // ── Auth guard for /rest/v1/* and /storage/v1/* ──
      .onRequest(async ({ request, set }) => {
        const url = new URL(request.url)
        if (url.pathname.startsWith('/rest/v1/') || url.pathname.startsWith('/storage/v1/')) {
          // Skip auth for OPTIONS preflight
          if (request.method === 'OPTIONS') return
          const authHeader = request.headers.get('authorization') ?? ''
          const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader
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
            } else {
              // In-memory: verify JWT signature
              await verifyAccessToken(token)
            }
          } catch {
            set.status = 401
            return { message: 'Invalid authorization token', code: '401' }
          }
        }
      })

      // ── PostgREST routes ──
    mountPostgrestRoutes(this.server, this.db)

    // ── Storage — /storage/v1/* ──
    this.server.use(createStoragePlugin(this.fileStore))

    // ── Admin UI — serve built Svelte SPA from /_/ ──
    this.mountAdminUI()

    // ── Stub routes — return 501 until ported ──

    // Catch-all for any unmatched /rest/v1/* paths
    this.server.all('/rest/v1/*', ({ set }) => {
      set.status = 501
      return { message: 'REST API not yet implemented', code: '501' }
    })

    // /api/* — PocketBase-native API (for admin UI, Phase 5)
    this.server.all('/api/*', ({ set }) => {
      set.status = 501
      return { message: 'API not yet implemented', code: '501' }
    })

    const port = this.config.port ?? 8090
    this.server.listen(port)
    console.log(`Sinopebase serving on http://127.0.0.1:${port}`)
  }

  /**
   * Stop the server gracefully.
   */
  async stop(): Promise<void> {
    if (this.server) {
      this.server.stop()
      this.server = null
    }
    this.db = null
  }

  /** Expose the database for base class usage. */
  getDatabase(): IDatabase | null {
    return this.db
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
   * Mount the admin UI static files at /_/.
   * Serves the built Svelte SPA from ui/dist/ with client-side routing fallback.
   */
  private mountAdminUI(): void {
    if (!this.server) return
    const distPath = './ui/dist'

    // Serve admin UI static files under /_/
    this.server.get('/_/', async ({ set }) => {
      try {
        const file = Bun.file(`${distPath}/index.html`)
        const exists = await file.exists()
        if (exists) {
          set.headers['Content-Type'] = 'text/html'
          return new Response(await file.arrayBuffer(), {
            headers: { 'Content-Type': 'text/html' },
          })
        }
      } catch { /* fall through */ }
      set.headers['Content-Type'] = 'text/html'
      return ADMIN_PLACEHOLDER
    })

    // Serve specific assets under /_/assets/* etc.
    this.server.get('/_/*', async ({ request, set, path }) => {
      try {
        // Extract the path after /_/
        const url = new URL(request.url)
        const filePath = url.pathname.replace(/^\/_/, '')

        // Prevent directory traversal
        if (filePath.includes('..')) {
          set.status = 403
          return 'Forbidden'
        }

        const fullPath = `${distPath}${filePath}`
        const file = Bun.file(fullPath)
        const exists = await file.exists()
        if (exists) {
          const ext = filePath.split('.').pop() || ''
          const mimeTypes: Record<string, string> = {
            html: 'text/html',
            css: 'text/css',
            js: 'application/javascript',
            mjs: 'application/javascript',
            json: 'application/json',
            png: 'image/png',
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            svg: 'image/svg+xml',
            ico: 'image/x-icon',
            woff: 'font/woff',
            woff2: 'font/woff2',
          }
          set.headers['Content-Type'] = mimeTypes[ext] || 'application/octet-stream'
          return new Response(await file.arrayBuffer(), {
            headers: { 'Content-Type': set.headers['Content-Type'] },
          })
        }

        // SPA fallback: serve index.html for any unmatched route
        const indexFile = Bun.file(`${distPath}/index.html`)
        if (await indexFile.exists()) {
          set.headers['Content-Type'] = 'text/html'
          return new Response(await indexFile.arrayBuffer(), {
            headers: { 'Content-Type': 'text/html' },
          })
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
    if (!this.db) return
    await this.db.createTable('todos')
  }
}
