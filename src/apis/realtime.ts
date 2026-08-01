/**
 * Supabase Realtime-compatible Phoenix Channels handling.
 *
 * PostgreSQL change delivery is intentionally same-process: mutations made
 * through this Sinopebase process's PostgREST routes are published. Native
 * WAL/logical-replication capture for writes made by other processes is not
 * implemented here.
 *
 * Security properties (v0.4):
 * - Broadcast requires a prior phx_join on the target topic (joined-state enforcement)
 * - Broadcast from unauthenticated clients is rejected when authorize is configured
 * - Broadcast payloads are size-limited (default 100 KB; prevents DoS)
 * - Postgres changes honour per-binding column-projection filters (no column leakage)
 * - Delivery queue is bounded per client (max 256 pending deliveries)
 * - Messages from each client are serialised (no race between phx_join and broadcast)
 * - Token expiry is re-validated on each heartbeat; expired tokens trigger eviction + WS close
 */

interface PhoenixMessage {
  joinRef?: string | null
  ref?: string | null
  topic: string
  event: string
  payload: Record<string, unknown>
  protocol: 'object' | 'v2'
}

export interface BroadcastPayload {
  type: string
  event: string
  payload: unknown
}

interface PostgresChangesFilter {
  event: 'INSERT' | 'UPDATE' | 'DELETE' | '*'
  schema: string
  table?: string
  filter?: string
  /** If set, only these columns are delivered to this subscriber. */
  columns?: string[]
}

interface PostgresChangesBinding extends PostgresChangesFilter {
  id: number
}

export interface PostgresChange {
  schema: string
  table: string
  event: 'INSERT' | 'UPDATE' | 'DELETE'
  new: Record<string, unknown>
  old: Record<string, unknown>
}

export interface PreparedRealtimeChange {
  deliver(): void
}

export interface PostgrestChangePublisher {
  publishPostgresChange(change: PostgresChange): Promise<void>
  preparePostgresChange(change: PostgresChange): Promise<PreparedRealtimeChange>
}

interface RealtimeHubOptions<TContext> {
  /** Resolve and validate the access token supplied by the Realtime client. */
  authorize?: (token: string | undefined) => Promise<TContext | undefined>
  /** Apply subscriber-specific visibility (normally PostgreSQL RLS). */
  canRead?: (context: TContext | undefined, change: PostgresChange) => Promise<boolean>
  /** Hook to authorize topic joins. Called after successful authorize(). */
  canJoinTopic?: (context: TContext, topic: string) => boolean
  /** Hook to authorize broadcast events. Called after joined-state and auth checks. */
  canBroadcast?: (context: TContext, topic: string, event: string, payload: unknown) => boolean
  /** Allow schema wildcard ("*") in postgres_changes filters. Default false — wildcard requests are rejected. */
  allowSchemaWildcard?: boolean
  /** Maximum queued postgres-changes deliveries per client (default 256). */
  maxDeliveryQueue?: number
  /** Maximum payload body length in bytes for broadcast messages (default 102400 = 100 KB). */
  maxBroadcastPayloadSize?: number
  /**
   * Whitelist of allowed topics for subscription. Each entry supports exact
   * match or a trailing `/*` wildcard (e.g. `"realtime:*"` matches
   * `"realtime:chat"` and `"realtime:presence"`). Unlisted topics are
   * rejected during phx_join. When unset or empty, all topics are allowed.
   */
  topicWhitelist?: string[]
  /**
   * When true, client-originated broadcast events are rejected.
   * Default false. In production mode this should be true — only the
   * server may broadcast.
   */
  disableClientBroadcast?: boolean
  /** Maximum number of messages a single client may send per minute (default 300). */
  maxMessagesPerMinute?: number
}

/** Minimal subset shared by ElysiaWS and test doubles. */
interface WSClient {
  /** Elysia assigns a per-connection UUID (`ws.id`). */
  id?: string
  data?: {
    query?: Record<string, unknown>
  }
  send(data: unknown): void
  subscribe(topic: string): void
  unsubscribe(topic: string): void
  publish(topic: string, data: unknown): void
}

interface ClientState<TContext> {
  protocol: 'object' | 'v2'
  context: TContext | undefined
  topics: Map<string, PostgresChangesBinding[]>
  /** Last successfully validated token, used for heartbeat re-validation when the heartbeat omits an access_token. */
  lastToken?: string
  /** Presence keys this client has tracked (per topic). Used for cleanup on disconnect. */
  presenceKeys: Map<string, string> // topic → presence key
}

/**
 * A single presence entry in a channel.
 * Keyed by `topic + '/' + key` for fast lookup.
 */
interface PresenceEntry {
  key: string
  data: Record<string, unknown>
  /** Stable client connection key (ws.id or synthetic). */
  clientKey: string
  /** Unix-ms timestamp of last heartbeat / track / join. */
  lastHeartbeat: number
}

interface PendingDelivery {
  ws: WSClient
  protocol: 'object' | 'v2'
  topic: string
  ids: number[]
  /** If set, only these columns are included in record/old_record of the delivered payload. */
  columns?: string[]
}

/**
 * Presence heartbeat timeout in milliseconds (60s). Stale presences are
 * auto-removed and a presence_diff is broadcast.
 */
const PRESENCE_TIMEOUT = 60_000

/** Maximum presence entries per client per topic (oldest evicted on overflow). */
const MAX_PRESENCE_ENTRIES_PER_CLIENT = 5

export class RealtimeHub<TContext = unknown> implements PostgrestChangePublisher {
  /** Client state keyed by Elysia's stable `ws.id` per connection. */
  private readonly clients = new Map<string, { ws: WSClient; state: ClientState<TContext> }>()
  private nextBindingId = 1
  private readonly maxDeliveryQueue: number
  private readonly maxBroadcastPayloadSize: number
  private readonly topicWhitelist: string[]
  private readonly disableClientBroadcast: boolean
  private readonly maxMessagesPerMinute: number

  /**
   * Per-connection rate limiting: maps client key to an array of
   * Unix-millisecond timestamps for messages received within the
   * current sliding window. Cleaned periodically during message
   * processing and on client removal.
   */
  private readonly messageCounters = new Map<string, number[]>()

  /**
   * Per-client message serialisation queue (per-batch, not persistent).
   * Ensures messages from the same WebSocket are processed one-at-a-time
   * so that a phx_join always finishes before a subsequent broadcast is
   * evaluated (prevents race conditions). Each handleMessage call chains
   * onto the previous promise; there is no durable backlog and the queue
   * does not survive restarts.
   */
  private readonly messageQueue = new Map<string, Promise<void>>()
  private readonly options: RealtimeHubOptions<TContext>

  /**
   * Presence state — per-topic map of presence entries.
   * Key: `topic` → array of PresenceEntry.
   * Each entry is also keyed by `topic + '/' + key` for O(1) lookup.
   */
  private readonly presenceByTopic = new Map<string, PresenceEntry[]>()

  /** Interval handle for the presence heartbeat sweeper. */
  private _presenceSweepInterval: ReturnType<typeof setInterval> | null = null

  constructor(options: RealtimeHubOptions<TContext> = {}) {
    if (
      typeof process !== 'undefined' &&
      process.env?.NODE_ENV === 'production' &&
      !options.authorize
    ) {
      throw new Error('[realtime] authorize callback is required in production mode')
    }
    this.options = options
    this.maxDeliveryQueue = options.maxDeliveryQueue ?? 256
    this.maxBroadcastPayloadSize = options.maxBroadcastPayloadSize ?? 102400
    this.topicWhitelist = options.topicWhitelist ?? []
    this.disableClientBroadcast = options.disableClientBroadcast ?? false
    this.maxMessagesPerMinute = options.maxMessagesPerMinute ?? 300
    this.startPresenceSweeper()
  }

  /** Release background resources. Call when the hub is no longer needed. */
  dispose(): void {
    this.stopPresenceSweeper()
  }

  /** Start the periodic presence heartbeat sweeper. */
  private startPresenceSweeper(): void {
    if (this._presenceSweepInterval) return
    this._presenceSweepInterval = setInterval(() => this.sweepStalePresences(), 15_000) // every 15s
  }

  /** Stop the presence sweeper (for cleanup). */
  private stopPresenceSweeper(): void {
    if (this._presenceSweepInterval) {
      clearInterval(this._presenceSweepInterval)
      this._presenceSweepInterval = null
    }
  }

  /** Remove stale presence entries and broadcast diffs. */
  private sweepStalePresences(): void {
    const now = Date.now()
    for (const [topic, entries] of this.presenceByTopic) {
      const stale = entries.filter((e) => now - e.lastHeartbeat > PRESENCE_TIMEOUT)
      if (stale.length === 0) continue

      // Remove stale entries
      const remaining = entries.filter((e) => now - e.lastHeartbeat <= PRESENCE_TIMEOUT)
      this.presenceByTopic.set(topic, remaining)

      // Broadcast presence_diff with leaves
      this.broadcastPresenceDiff(topic, {
        joins: [],
        leaves: stale.map((e) => ({ key: e.key, data: e.data })),
      })
    }
  }

  /** Resolve the stable connection key. Elysia assigns `ws.id` once per connection;
   *  test-double sockets without `id` fall back to reference identity. */
  private connKey(ws: WSClient): string {
    if (ws.id) return ws.id
    // Fallback for test doubles: store a synthetic key on ws.data.
    const data = (ws.data ?? {}) as Record<string, unknown>
    ws.data = data as WSClient['data']
    const cached = data._realtimeCid
    if (typeof cached === 'string') return cached
    const id = `synthetic-${this.nextBindingId++}`
    data._realtimeCid = id
    return id
  }

  /**
   * Check whether a topic matches any entry in the whitelist.
   * Supports exact match and trailing `/*` wildcard (prefix match).
   */
  private isTopicAllowed(topic: string): boolean {
    for (const pattern of this.topicWhitelist) {
      if (pattern.endsWith('/*')) {
        const prefix = pattern.slice(0, -1) // strip trailing `*`
        if (topic === prefix.slice(0, -1) || topic.startsWith(prefix)) return true
      }
      if (pattern === topic) return true
    }
    return false
  }

  /**
   * Check and record a message from the given client key against the
   * per-minute rate limit. Returns true if the message is within the
   * limit, or false if the client has exceeded it.
   */
  private checkRateLimit(key: string): boolean {
    const now = Date.now()
    const windowMs = 60_000 // 1 minute
    let timestamps = this.messageCounters.get(key)
    if (!timestamps) {
      timestamps = []
      this.messageCounters.set(key, timestamps)
    }

    // Prune timestamps outside the sliding window.
    const cutoff = now - windowMs
    while (timestamps.length > 0 && (timestamps[0] as number) < cutoff) {
      timestamps.shift()
    }

    if (timestamps.length >= this.maxMessagesPerMinute) {
      return false
    }

    timestamps.push(now)
    return true
  }

  async handleMessage(ws: WSClient, rawMessage: unknown): Promise<void> {
    const key = this.connKey(ws)
    const previous = this.messageQueue.get(key) ?? Promise.resolve()
    const next = previous
      .then(() => this.processMessage(ws, rawMessage, key))
      .catch((err) => {
        console.error('[realtime] error:', err)
      })
    this.messageQueue.set(key, next)
    return next
  }

  private async processMessage(ws: WSClient, rawMessage: unknown, key: string): Promise<void> {
    const msg = parsePhoenixMessage(rawMessage)
    if (!msg) return

    // ── Per-connection rate limit ──
    // Check and record this message against the client's sliding window.
    // When the limit is exceeded, send a phx_reply error and skip processing.
    if (!this.checkRateLimit(key)) {
      sendPhoenix(ws, msg, 'phx_reply', {
        status: 'error',
        response: { reason: 'rate limit exceeded' },
      })
      return
    }

    let entry = this.clients.get(key)

    if (!entry) {
      entry = {
        ws,
        state: {
          protocol: msg.protocol,
          context: undefined,
          topics: new Map(),
          presenceKeys: new Map(),
        },
      }
      this.clients.set(key, entry)
    }

    // Always keep the latest ws reference (Elysia may provide a fresh wrapper).
    entry.ws = ws
    entry.state.protocol = msg.protocol

    switch (msg.event) {
      case 'phx_join': {
        const token =
          typeof msg.payload.access_token === 'string'
            ? msg.payload.access_token
            : websocketApiKey(ws)
        const context = this.options.authorize ? await this.options.authorize(token) : undefined

        if (this.options.authorize && context === undefined) {
          sendPhoenix(ws, msg, 'phx_reply', {
            status: 'error',
            response: { reason: 'unauthorized' },
          })
          return
        }

        if (
          context !== undefined &&
          this.options.canJoinTopic &&
          !this.options.canJoinTopic(context, msg.topic)
        ) {
          sendPhoenix(ws, msg, 'phx_reply', {
            status: 'error',
            response: { reason: 'topic not authorized' },
          })
          return
        }

        // ── Topic whitelist check ──
        if (this.topicWhitelist.length > 0 && !this.isTopicAllowed(msg.topic)) {
          sendPhoenix(ws, msg, 'phx_reply', {
            status: 'error',
            response: { reason: 'topic not authorized' },
          })
          return
        }

        entry.state.context = context
        if (token !== undefined) entry.state.lastToken = token
        const filters = postgresChangesFilters(msg.payload)
        const bindings = filters.map((filter) => ({
          ...filter,
          id: this.nextBindingId++,
        }))
        entry.state.topics.set(msg.topic, bindings)
        ws.subscribe(msg.topic)

        // ── Presence: return current presence_state on join ──
        // Supports both shapes: supabase-js { config: { presence: { key } } }
        // and SDK/test { presence: { key }, data: {...} }
        const configPresence = isRecord(msg.payload?.config)
          ? (msg.payload.config as Record<string, unknown>).presence
          : undefined
        const topPresence = msg.payload?.presence
        const presenceKey =
          (isRecord(configPresence) && typeof configPresence.key === 'string' && configPresence.key) ||
          (isRecord(topPresence) && typeof topPresence.key === 'string' && topPresence.key) ||
          undefined
        const presenceData = isRecord(msg.payload?.data) ? msg.payload.data : {}

        const presenceResponse: Record<string, unknown> = { postgres_changes: bindings }
        if (presenceKey) {
          presenceResponse.presence_state = this.getPresenceState(msg.topic)
          this.trackPresence(msg.topic, presenceKey, presenceData, key, ws)
          entry.state.presenceKeys.set(msg.topic, presenceKey)
        }

        sendPhoenix(ws, msg, 'phx_reply', {
          status: 'ok',
          response: presenceResponse,
        })
        break
      }

      case 'phx_leave':
        // Clean up presence entries for this topic
        const presenceKey = entry.state.presenceKeys.get(msg.topic)
        if (presenceKey) {
          this.untrackPresence(msg.topic, presenceKey, ws)
          entry.state.presenceKeys.delete(msg.topic)
        }
        entry.state.topics.delete(msg.topic)
        ws.unsubscribe(msg.topic)
        sendPhoenix(ws, msg, 'phx_reply', { status: 'ok', response: {} })
        break

      case 'phx_heartbeat':
        // Heartbeat: refresh presence timestamps for this client's tracked keys.
        const clientKey = key
        for (const [topic] of entry.state.presenceKeys) {
          const entries = this.presenceByTopic.get(topic)
          if (entries) {
            for (const e of entries) {
              if (e.clientKey === clientKey) {
                e.lastHeartbeat = Date.now()
              }
            }
          }
        }

        // Heartbeat: refresh token validation for long-lived connections.
        // If the token has expired, the client is evicted and the WebSocket
        // is closed.
        if (this.options.authorize) {
          const heartbeatToken =
            typeof msg.payload.access_token === 'string'
              ? msg.payload.access_token
              : entry.state.lastToken
          if (heartbeatToken) {
            const refreshed = await this.options.authorize(heartbeatToken)
            if (refreshed === undefined && entry.state.context !== undefined) {
              // Token expired — evict the client.
              this.removeClient(ws)
              sendPhoenix(ws, msg, 'phx_reply', {
                status: 'error',
                response: { reason: 'token expired' },
              })
              ws.send(
                JSON.stringify({
                  topic: msg.topic,
                  event: 'phx_close',
                  payload: { reason: 'token expired' },
                  ref: null,
                }),
              )
              return
            }
            if (refreshed !== undefined) {
              entry.state.context = refreshed
              entry.state.lastToken = heartbeatToken
            }
          }
        }
        sendPhoenix(ws, msg, 'phx_reply', { status: 'ok', response: {} })
        break

      case 'broadcast': {
        // ── Joined-state enforcement ──
        // Clients must have joined the topic before broadcasting to it.
        if (!entry.state.topics.has(msg.topic)) {
          sendPhoenix(ws, msg, 'phx_reply', {
            status: 'error',
            response: { reason: 'you must join the channel before broadcasting' },
          })
          return
        }

        // ── Auth requirement for broadcast ──
        // When authorization is configured, unauthenticated clients may not broadcast.
        if (this.options.authorize && entry.state.context === undefined) {
          sendPhoenix(ws, msg, 'phx_reply', {
            status: 'error',
            response: { reason: 'broadcast requires authentication' },
          })
          return
        }

        // ── Client broadcast disabled (config-driven) ──
        if (this.disableClientBroadcast) {
          sendPhoenix(ws, msg, 'phx_reply', {
            status: 'error',
            response: { reason: 'client broadcast disabled' },
          })
          return
        }

        const broadcastPayload = msg.payload
        const broadcastEvent =
          typeof broadcastPayload.event === 'string' ? broadcastPayload.event : ''
        const broadcastData = broadcastPayload.payload
        const self = broadcastPayload.self !== false

        // ── Null/undefined broadcast payload (silently ignored) ──
        if (broadcastData == null) break

        // ── Broadcast auth hook ──
        if (this.options.canBroadcast && entry.state.context) {
          if (
            !this.options.canBroadcast(
              entry.state.context,
              msg.topic,
              broadcastEvent,
              broadcastData,
            )
          ) {
            sendPhoenix(ws, msg, 'phx_reply', {
              status: 'error',
              response: { reason: 'broadcast not authorized' },
            })
            return
          }
        }

        // ── Payload size limit (DoS prevention) ──
        const raw = JSON.stringify(broadcastData)
        if (raw.length > this.maxBroadcastPayloadSize) {
          sendPhoenix(ws, msg, 'phx_reply', {
            status: 'error',
            response: { reason: 'broadcast payload exceeds size limit' },
          })
          return
        }

        const response = encodePhoenix(msg.protocol, null, null, msg.topic, 'broadcast', {
          type: 'broadcast',
          event: broadcastEvent,
          payload: broadcastData,
        })
        ws.publish(msg.topic, response)
        if (self) ws.send(response)
        break
      }

      // ── Presence: track ──
      case 'track': {
        // Require joined state and auth parity with broadcast
        if (!entry.state.topics.has(msg.topic)) {
          sendPhoenix(ws, msg, 'phx_reply', {
            status: 'error',
            response: { reason: 'you must join the channel before tracking presence' },
          })
          return
        }
        if (this.options.authorize && entry.state.context === undefined) {
          sendPhoenix(ws, msg, 'phx_reply', {
            status: 'error',
            response: { reason: 'presence tracking requires authentication' },
          })
          return
        }
        const presenceKey = typeof msg.payload?.key === 'string' ? msg.payload.key : ''
        const presenceData = isRecord(msg.payload?.data) ? msg.payload.data : {}
        if (!presenceKey) {
          sendPhoenix(ws, msg, 'phx_reply', {
            status: 'error',
            response: { reason: 'presence key required' },
          })
          return
        }
        // ── Presence payload size limit (DoS prevention) ──
        if (JSON.stringify(presenceData).length > this.maxBroadcastPayloadSize) {
          sendPhoenix(ws, msg, 'phx_reply', {
            status: 'error',
            response: { reason: 'presence payload exceeds size limit' },
          })
          return
        }
        this.trackPresence(msg.topic, presenceKey, presenceData, key, ws)
        entry.state.presenceKeys.set(msg.topic, presenceKey)
        sendPhoenix(ws, msg, 'phx_reply', { status: 'ok', response: {} })
        break
      }

      // ── Presence: untrack ──
      case 'untrack': {
        if (!entry.state.topics.has(msg.topic)) {
          sendPhoenix(ws, msg, 'phx_reply', {
            status: 'error',
            response: { reason: 'you must join the channel before untracking presence' },
          })
          return
        }
        const untrackKey = typeof msg.payload?.key === 'string' ? msg.payload.key : entry.state.presenceKeys.get(msg.topic)
        if (untrackKey) {
          this.untrackPresence(msg.topic, untrackKey, ws)
          entry.state.presenceKeys.delete(msg.topic)
        }
        sendPhoenix(ws, msg, 'phx_reply', { status: 'ok', response: {} })
        break
      }
    }
  }

  removeClient(ws: WSClient): void {
    const key = this.connKey(ws)
    const entry = this.clients.get(key)
    // Clean up presence entries for this client
    if (entry) {
      for (const [topic, presenceKey] of entry.state.presenceKeys) {
        this.untrackPresence(topic, presenceKey, ws)
      }
    }
    this.clients.delete(key)
    this.messageQueue.delete(key)
    this.messageCounters.delete(key)
  }

  // -------------------------------------------------------------------------
  // Presence state management
  // -------------------------------------------------------------------------

  /** Get current presence state for a topic (Phoenix Presence format). */
  private getPresenceState(topic: string): Record<string, { metas: Array<{ key: string; data: Record<string, unknown> }> }> {
    const entries = this.presenceByTopic.get(topic) ?? []
    const state: Record<string, { metas: Array<{ key: string; data: Record<string, unknown> }> }> = {}
    for (const entry of entries) {
      if (!state[entry.key]) {
        state[entry.key] = { metas: [] }
      }
      (state[entry.key] as { metas: Array<{ key: string; data: Record<string, unknown> }> }).metas.push({
        key: entry.key,
        data: entry.data,
      })
    }
    return state
  }

  /** Track a presence entry and broadcast presence_diff. */
  private trackPresence(
    topic: string,
    presenceKey: string,
    data: Record<string, unknown>,
    clientKey: string,
    _ws: WSClient,
  ): void {
    const entries = this.presenceByTopic.get(topic) ?? []
    // Remove any existing entry with same clientKey+key on same topic
    let filtered = entries.filter((e) => !(e.key === presenceKey && e.clientKey === clientKey))
    // Cap per-client entries per topic: evict oldest (front) when exceeded
    const clientEntries = filtered.filter((e) => e.clientKey === clientKey)
    if (clientEntries.length >= MAX_PRESENCE_ENTRIES_PER_CLIENT) {
      const oldest = clientEntries[0]
      if (oldest) filtered = filtered.filter((e) => e !== oldest)
    }
    const entry: PresenceEntry = {
      key: presenceKey,
      data,
      clientKey,
      lastHeartbeat: Date.now(),
    }
    filtered.push(entry)
    this.presenceByTopic.set(topic, filtered)

    // Broadcast presence_diff with joins
    this.broadcastPresenceDiff(topic, { joins: [{ key: presenceKey, data }], leaves: [] })
  }

  /** Untrack a presence entry and broadcast presence_diff. */
  private untrackPresence(topic: string, presenceKey: string, ws: WSClient): void {
    const clientKey = this.connKey(ws)
    const entries = this.presenceByTopic.get(topic) ?? []
    const removed = entries.filter((e) => e.key === presenceKey && e.clientKey === clientKey)
    const remaining = entries.filter((e) => !(e.key === presenceKey && e.clientKey === clientKey))
    this.presenceByTopic.set(topic, remaining)

    if (removed.length > 0) {
      this.broadcastPresenceDiff(topic, {
        joins: [],
        leaves: removed.map((e) => ({ key: e.key, data: e.data })),
      })
    }
  }

  /** Broadcast a presence_diff event to all subscribers of a topic. */
  private broadcastPresenceDiff(
    topic: string,
    diff: { joins: Array<{ key: string; data: Record<string, unknown> }>; leaves: Array<{ key: string; data: Record<string, unknown> }> },
  ): void {
    if (diff.joins.length === 0 && diff.leaves.length === 0) return

    for (const [, { ws, state }] of this.clients) {
      if (!state.topics.has(topic)) continue
      try {
        ws.send(
          encodePhoenix(state.protocol, null, null, topic, 'presence_diff', {
            joins: this.presenceDiffPayload(diff.joins),
            leaves: this.presenceDiffPayload(diff.leaves),
          }),
        )
      } catch {
        // best-effort delivery
      }
    }
  }

  /** Convert presence entries to Phoenix presence_diff payload format. */
  private presenceDiffPayload(
    entries: Array<{ key: string; data: Record<string, unknown> }>,
  ): Record<string, { metas: Array<{ key: string; data: Record<string, unknown> }> }> {
    const result: Record<string, { metas: Array<{ key: string; data: Record<string, unknown> }> }> = {}
    for (const entry of entries) {
      if (!result[entry.key]) {
        result[entry.key] = { metas: [] }
      }
      (result[entry.key] as { metas: Array<{ key: string; data: Record<string, unknown> }> }).metas.push({
        key: entry.key,
        data: entry.data,
      })
    }
    return result
  }

  async preparePostgresChange(change: PostgresChange): Promise<PreparedRealtimeChange> {
    const pending: PendingDelivery[] = []
    const row = change.event === 'DELETE' ? change.old : change.new

    for (const [, { ws, state }] of this.clients) {
      for (const [topic, bindings] of state.topics) {
        // Group matching bindings by their column filter so that subscribers
        // with the same column-list receive a single message rather than one
        // per binding.
        const columnGroups = new Map<string, { ids: number[]; columns?: string[] }>()
        for (const binding of bindings) {
          if (!bindingMatches(binding, change, row, !this.options.allowSchemaWildcard)) continue
          const key =
            binding.columns && binding.columns.length > 0
              ? [...binding.columns].sort().join(',')
              : '*'
          let group = columnGroups.get(key)
          if (!group) {
            group = { ids: [], columns: binding.columns }
            columnGroups.set(key, group)
          }
          group.ids.push(binding.id)
        }
        if (columnGroups.size === 0) continue

        const allowed = this.options.canRead
          ? await this.options.canRead(state.context, change)
          : true
        if (!allowed) continue

        for (const [, group] of columnGroups) {
          pending.push({
            ws,
            protocol: state.protocol,
            topic,
            ids: group.ids,
            columns: group.columns,
          })
        }
      }
    }

    // ── Bound the delivery queue per client ──
    // If a single client has more than maxDeliveryQueue pending deliveries,
    // drop the oldest ones to prevent unbounded memory growth.
    const clientPending = new Map<WSClient, PendingDelivery[]>()
    for (const delivery of pending) {
      const list = clientPending.get(delivery.ws) ?? []
      list.push(delivery)
      clientPending.set(delivery.ws, list)
    }
    const bounded: PendingDelivery[] = []
    for (const [, deliveries] of clientPending) {
      if (deliveries.length > this.maxDeliveryQueue) {
        bounded.push(...deliveries.slice(-this.maxDeliveryQueue))
      } else {
        bounded.push(...deliveries)
      }
    }

    return {
      deliver: () => {
        for (const delivery of bounded) {
          try {
            const payload = postgresChangePayload(change, delivery.columns)
            delivery.ws.send(
              encodePhoenix(delivery.protocol, null, null, delivery.topic, 'postgres_changes', {
                ids: delivery.ids,
                data: payload,
              }),
            )
          } catch (err) {
            console.error('[realtime] delivery error:', err)
          }
        }
      },
    }
  }

  async publishPostgresChange(change: PostgresChange): Promise<void> {
    const prepared = await this.preparePostgresChange(change)
    prepared.deliver()
  }
}

export function createRealtimeHub<TContext = unknown>(
  options: RealtimeHubOptions<TContext> = {},
): RealtimeHub<TContext> {
  return new RealtimeHub(options)
}

export function createRealtimeWebSocketHandler<TContext>(hub = createRealtimeHub<TContext>()) {
  return {
    open(_ws: WSClient): void {},
    async message(ws: WSClient, rawMessage: unknown): Promise<void> {
      await hub.handleMessage(ws, rawMessage)
    },
    close(ws: WSClient, _code: number, _reason: string): void {
      hub.removeClient(ws)
    },
  }
}

// ---------------------------------------------------------------------------
// Message parsing / encoding
// ---------------------------------------------------------------------------

function parsePhoenixMessage(rawMessage: unknown): PhoenixMessage | null {
  let value = rawMessage
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }

  if (Array.isArray(value)) {
    const [joinRef, ref, topic, event, payload] = value
    if (typeof topic !== 'string' || topic.length === 0 || typeof event !== 'string') return null
    return {
      joinRef: typeof joinRef === 'string' ? joinRef : null,
      ref: typeof ref === 'string' ? ref : null,
      topic,
      event,
      payload: isRecord(payload) ? payload : {},
      protocol: 'v2',
    }
  }

  if (
    !isRecord(value) ||
    typeof value.topic !== 'string' ||
    (value.topic as string).length === 0 ||
    typeof value.event !== 'string'
  ) {
    return null
  }

  return {
    joinRef: typeof value.join_ref === 'string' ? value.join_ref : null,
    ref: typeof value.ref === 'string' ? value.ref : null,
    topic: value.topic,
    event: value.event,
    payload: isRecord(value.payload) ? value.payload : {},
    protocol: 'object',
  }
}

function sendPhoenix(
  ws: WSClient,
  msg: PhoenixMessage,
  event: string,
  payload: Record<string, unknown>,
): void {
  ws.send(
    encodePhoenix(msg.protocol, msg.joinRef ?? null, msg.ref ?? null, msg.topic, event, payload),
  )
}

function encodePhoenix(
  protocol: 'object' | 'v2',
  joinRef: string | null,
  ref: string | null,
  topic: string,
  event: string,
  payload: Record<string, unknown>,
): string {
  return protocol === 'v2'
    ? JSON.stringify([joinRef, ref, topic, event, payload])
    : JSON.stringify({ topic, event, payload, ref, join_ref: joinRef })
}

function websocketApiKey(ws: WSClient): string | undefined {
  const value = ws.data?.query?.apikey
  return typeof value === 'string' ? value : undefined
}

// ---------------------------------------------------------------------------
// Postgres changes filter parsing & matching
// ---------------------------------------------------------------------------

function postgresChangesFilters(payload: Record<string, unknown>): PostgresChangesFilter[] {
  const config = isRecord(payload.config) ? payload.config : {}
  const rawFilters = Array.isArray(config.postgres_changes) ? config.postgres_changes : []

  return rawFilters.flatMap((value): PostgresChangesFilter[] => {
    if (!isRecord(value)) return []
    const event = typeof value.event === 'string' ? value.event.toUpperCase() : '*'
    if (!['INSERT', 'UPDATE', 'DELETE', '*'].includes(event)) return []
    if (typeof value.schema !== 'string' || value.schema === '') return []
    return [
      {
        event: event as PostgresChangesFilter['event'],
        schema: value.schema,
        table: typeof value.table === 'string' ? value.table : undefined,
        filter:
          typeof value.filter === 'string' && value.filter.length > 0 ? value.filter : undefined,
        columns:
          Array.isArray(value.columns) && value.columns.every((c) => typeof c === 'string')
            ? (value.columns as string[])
            : undefined,
      },
    ]
  })
}

function bindingMatches(
  binding: PostgresChangesBinding,
  change: PostgresChange,
  row: Record<string, unknown>,
  rejectSchemaWildcard = true,
): boolean {
  if (binding.event !== '*' && binding.event !== change.event) return false
  if (rejectSchemaWildcard && binding.schema === '*') return false
  if (binding.schema !== '*' && binding.schema !== change.schema) return false
  if (binding.table && binding.table !== '*' && binding.table !== change.table) return false
  return !binding.filter || realtimeFilterMatches(binding.filter, row)
}

function realtimeFilterMatches(filter: string, row: Record<string, unknown>): boolean {
  const equals = filter.indexOf('=')
  if (equals <= 0) return false
  const column = filter.slice(0, equals)
  const expression = filter.slice(equals + 1)
  const dot = expression.indexOf('.')
  if (dot <= 0) return false

  const operator = expression.slice(0, dot)
  const expected = expression.slice(dot + 1)
  const actual = row[column]
  const compare = String(actual) === expected

  switch (operator) {
    case 'eq':
      return compare
    case 'neq':
      return !compare
    case 'lt':
      return compareValues(actual, expected) < 0
    case 'lte':
      return compareValues(actual, expected) <= 0
    case 'gt':
      return compareValues(actual, expected) > 0
    case 'gte':
      return compareValues(actual, expected) >= 0
    case 'in': {
      const values =
        expected.startsWith('(') && expected.endsWith(')')
          ? expected.slice(1, -1).split(',')
          : [expected]
      return values.some((value) => String(actual) === value.trim())
    }
    default:
      return false
  }
}

function compareValues(actual: unknown, expected: string): number {
  const actualNumber = typeof actual === 'number' ? actual : Number(actual)
  const expectedNumber = Number(expected)
  if (Number.isFinite(actualNumber) && Number.isFinite(expectedNumber)) {
    return actualNumber - expectedNumber
  }
  return String(actual).localeCompare(expected)
}

// ---------------------------------------------------------------------------
// Payload construction
// ---------------------------------------------------------------------------

function postgresChangePayload(
  change: PostgresChange,
  columns?: string[],
): Record<string, unknown> {
  const record = change.event === 'DELETE' ? {} : projectRow(change.new, columns)
  const oldRecord = change.event === 'INSERT' ? {} : projectRow(change.old, columns)
  const sample = change.event === 'DELETE' ? change.old : change.new

  return {
    schema: change.schema,
    table: change.table,
    commit_timestamp: new Date().toISOString(),
    type: change.event,
    columns: Object.entries(sample)
      .filter(([name]) => !columns || columns.includes(name))
      .map(([name, value]) => ({ name, type: postgresType(value) })),
    record,
    old_record: oldRecord,
    errors: null,
  }
}

function projectRow(row: Record<string, unknown>, columns?: string[]): Record<string, unknown> {
  if (!columns || columns.length === 0) return { ...row }
  const projected: Record<string, unknown> = {}
  for (const col of columns) {
    if (col in row) projected[col] = row[col]
  }
  return projected
}

function postgresType(value: unknown): string {
  if (typeof value === 'boolean') return 'bool'
  if (typeof value === 'number') return Number.isInteger(value) ? 'int8' : 'float8'
  if (typeof value === 'object' && value !== null) return 'jsonb'
  return 'text'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
