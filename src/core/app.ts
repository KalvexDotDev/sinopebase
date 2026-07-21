/**
 * Sinopebase Core Application
 *
 * Port of PocketBase core/app.go + core/base.go
 * The central App interface — ~175 methods in the Go version.
 *
 * This is the Skeleton. Layer 2 porting (ultracode) fills it in.
 */

import { Elysia } from 'elysia'
import { createRealtimeWebSocketHandler } from '../apis/realtime'
import { authPlugin } from '../apis/auth'
import type { IDatabase } from './db-interface'
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
export class Sinopebase {
  private config: AppConfig
  private server: Elysia | null = null
  private db: IDatabase | null = null
  private store: IFileStore | null = null

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
    } else {
      this.db = new MemoryDatabase()
      console.log('Database: in-memory (no POSTGRES_URL set)')
    }

    // Initialize storage: RustFS/S3 or local fallback
    const s3Endpoint = this.config.minioEndpoint || process.env.RUSTFS_ENDPOINT || ''
    const s3AccessKey = this.config.minioAccessKey || process.env.RUSTFS_ACCESS_KEY || ''
    const s3SecretKey = this.config.minioSecretKey || process.env.RUSTFS_SECRET_KEY || ''
    if (s3Endpoint && s3AccessKey && s3SecretKey) {
      this.store = new S3FileStore({
        endpoint: s3Endpoint,
        accessKey: s3AccessKey,
        secretKey: s3SecretKey,
      })
      console.log(`Storage: S3 (${this.config.minioEndpoint})`)
    } else {
      this.store = new LocalFileStore(this.config.dataDir ?? './pb_data')
      console.log('Storage: local filesystem (no RUSTFS_ENDPOINT set)')
    }

    // Create required tables
    await this.ensureTables()

    this.server = new Elysia()
      // Health check
      .get('/api/health', () => ({
        code: 200,
        message: 'Sinopebase is running',
        db: this.db instanceof PostgresDatabase ? 'postgresql' : 'memory',
        storage: this.store instanceof S3FileStore ? 's3' : 'local',
      }))

      // ── Realtime WebSocket ──
      .ws('/realtime/v1/websocket', createRealtimeWebSocketHandler())

      // ── Auth — /auth/v1/* ──
      .use(authPlugin)

      // ── PostgREST routes ──
    mountPostgrestRoutes(this.server, this.db)

    // ── Storage — /storage/v1/* ──
    this.server.use(createStoragePlugin(this.store))

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

  /**
   * Create required tables in the in-memory database.
   */
  private async ensureTables(): Promise<void> {
    if (!this.db) return
    await this.db.createTable('todos')
  }
}
