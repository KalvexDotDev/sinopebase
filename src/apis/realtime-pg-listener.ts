/**
 * PostgreSQL LISTEN/NOTIFY listener for cross-process realtime fan-out.
 *
 * When enabled, each Sinopebase process listens on the `sinopebase_changes`
 * channel. Database triggers fire `pg_notify()` on INSERT/UPDATE/DELETE to
 * user tables. The listener parses the JSON payload, skips self-originated
 * notifications (matched by process_id), and forwards remaining changes to
 * the local RealtimeHub for delivery to connected WebSocket clients.
 *
 * Architecture:
 *   [External SQL] --INSERT--> [PostgreSQL] --trigger--> pg_notify()
 *                                                           |
 *   [PgRealtimeListener] (dedicated pg.Client) <-- LISTEN --+
 *        |
 *        +--> RealtimeHub.publishPostgresChange() --> WS clients
 */

import type { Pool, PoolClient } from 'pg'
import type { PostgresChange, PostgrestChangePublisher } from './realtime'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PgRealtimeListenerOptions {
  /** pg Pool to check out a dedicated client from. */
  pool: Pool
  /** The RealtimeHub to forward changes to. */
  hub: PostgrestChangePublisher
  /** Unique identifier for this process (UUID). */
  processId: string
  /** PG channel name to listen on (default: 'sinopebase_changes'). */
  channel?: string
  /** Logger function. */
  log?: (message: string, data?: Record<string, unknown>) => void
  /** Heartbeat period in milliseconds (default 15000). */
  heartbeatIntervalMs?: number
}

interface NotificationPayload {
  process_id?: string
  table: string
  schema: string
  event: string
  new: Record<string, unknown>
  old: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// PgRealtimeListener
// ---------------------------------------------------------------------------

export class PgRealtimeListener {
  private client: PoolClient | null = null
  private readonly pool: Pool
  private readonly hub: PostgrestChangePublisher
  private readonly processId: string
  private readonly channel: string
  private readonly log: (message: string, data?: Record<string, unknown>) => void
  private readonly heartbeatIntervalMs: number
  private running = false
  private reconnectDelay = 1000
  private maxReconnectDelay = 30000
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private checking = false

  constructor(options: PgRealtimeListenerOptions) {
    this.pool = options.pool
    this.hub = options.hub
    this.processId = options.processId
    this.channel = options.channel ?? 'sinopebase_changes'
    this.log = options.log ?? (() => {})
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15_000
  }

  /** Start listening. Idempotent — calling start() on a running listener is a no-op. */
  async start(): Promise<void> {
    if (this.running) return
    this.running = true

    try {
      this.client = await this.pool.connect()
      this.log('[realtime-pg] Connected to PostgreSQL for LISTEN/NOTIFY', {
        channel: this.channel,
        processId: this.processId,
      })

      // Set process ID on the connection so the trigger function can read it
      await this.client.query(`SELECT set_config('app.sinopebase_process_id', $1, false)`, [
        this.processId,
      ])

      // Start listening
      await this.client.query(`LISTEN "${this.channel}"`)

      // Attach notification handler
      this.client.on('notification', (msg) => {
        this.handleNotification({ channel: msg.channel, payload: msg.payload ?? '' })
      })

      // Handle connection errors with reconnection
      this.client.on('error', (err: Error) => {
        this.log('[realtime-pg] Connection error', { error: err.message })
        this.reconnect()
      })

      this.client.on('end', () => {
        if (this.running) {
          this.log('[realtime-pg] Connection ended, reconnecting...')
          this.reconnect()
        }
      })

      // Reset reconnect delay on successful connection
      this.reconnectDelay = 1000
      this.heartbeatTimer = setInterval(() => {
        const client = this.client
        if (this.checking || !client) return
        this.checking = true
        let timeout: ReturnType<typeof setTimeout> | null = null
        Promise.race([
          client.query('SELECT 1'),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error('listener heartbeat timed out')), 5000)
          }),
        ])
          .catch((err: Error) => {
            this.log('[realtime-pg] Heartbeat failed', { error: err.message })
            if (this.client === client) this.reconnect()
          })
          .finally(() => {
            if (timeout) clearTimeout(timeout)
            this.checking = false
          })
      }, this.heartbeatIntervalMs)
    } catch (err) {
      this.log('[realtime-pg] Failed to start listener', {
        error: (err as Error).message,
      })
      this.client?.release(true)
      this.client = null
      if (this.running) this.scheduleReconnect()
      throw err
    }
  }

  isConnected(): boolean {
    return this.running && this.client !== null
  }

  /** Stop listening and release the connection. */
  async stop(): Promise<void> {
    this.running = false
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
    this.client?.release(true)
    this.client = null
  }

  // ── Private ──

  private handleNotification(msg: { channel: string; payload: string }): void {
    try {
      const payload: NotificationPayload = JSON.parse(msg.payload)

      // Skip self-originated notifications
      if (payload.process_id === this.processId) return

      const event = normalizeEvent(payload.event)
      if (!event) return

      const change: PostgresChange = {
        schema: payload.schema,
        table: payload.table,
        event,
        new: payload.new ?? {},
        old: payload.old ?? {},
      }

      this.hub.publishPostgresChange(change).catch((err) => {
        this.log('[realtime-pg] Failed to publish change', { error: (err as Error).message })
      })
    } catch (err) {
      this.log('[realtime-pg] Failed to parse notification', {
        error: (err as Error).message,
      })
    }
  }

  private reconnect(): void {
    if (!this.running) return
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
    // Release old client if any
    try {
      this.client?.release(true)
    } catch {
      /* ignore */
    }
    this.client = null

    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (this.retryTimer) return
    const delay = this.reconnectDelay
    this.log('[realtime-pg] Reconnecting', { delayMs: delay })
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (!this.running) return
      this.running = false // reset so start() can re-enter
      this.start().catch(() => {})
    }, delay)

    // Exponential backoff
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeEvent(pgOp: string): PostgresChange['event'] | null {
  switch (pgOp.toUpperCase()) {
    case 'INSERT':
      return 'INSERT'
    case 'UPDATE':
      return 'UPDATE'
    case 'DELETE':
      return 'DELETE'
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Trigger management
// ---------------------------------------------------------------------------

/**
 * Attach the `sinopebase_notify_change` trigger to all user tables in the
 * public schema. Skips internal/tracking tables.
 */
export async function attachRealtimeTriggers(
  pool: Pool,
  log?: (msg: string, data?: Record<string, unknown>) => void,
  strict = false,
): Promise<void> {
  const logger = log ?? (() => {})
  try {
    // Discover user tables (exclude internal ones)
    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND left(table_name, 1) <> '_'
        AND table_name NOT IN ('schema_migrations', 'migrations')
    `)

    for (const row of result.rows) {
      const tableName = row.table_name as string
      const quotedTable = `"${tableName.replaceAll('"', '""')}"`
      const triggerName = `"${`sinopebase_notify_${tableName}`.replaceAll('"', '""')}"`
      try {
        // Identifiers originate in the catalog, but still require quoting.
        const exists = await pool.query(
          `SELECT 1 FROM pg_trigger WHERE tgname = $1 AND tgrelid = $2::regclass`,
          [`sinopebase_notify_${tableName}`, `public.${quotedTable}`],
        )
        if (exists.rowCount === 0) {
          await pool.query(`CREATE TRIGGER ${triggerName}
            AFTER INSERT OR UPDATE OR DELETE ON public.${quotedTable}
            FOR EACH ROW EXECUTE FUNCTION sinopebase_notify_change()`)
        }
        logger('[realtime-pg] Attached trigger', { table: tableName })
      } catch (err) {
        // Another replica may have attached the same trigger after our check.
        if ((err as { code?: string }).code === '42710') continue
        if (strict) throw err
        logger('[realtime-pg] Failed to attach trigger', {
          table: tableName,
          error: (err as Error).message,
        })
      }
    }
  } catch (err) {
    if (strict) throw err
    logger('[realtime-pg] Failed to discover tables', {
      error: (err as Error).message,
    })
  }
}
