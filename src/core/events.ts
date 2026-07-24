/**
 * All PocketBase event type definitions.
 *
 * Port of PocketBase core/events.go (Go -> TypeScript).
 *
 * These event types are used with the Hook and TaggedHook systems
 * defined in ~/tools/hook/.
 */

import { Event } from '~/tools/hook/event'
import type { Tagger } from '~/tools/hook/tagged'
import type { Model } from './db_model'

// ---------------------------------------------------------------------------
// Base events with tag support
// ---------------------------------------------------------------------------

/**
 * BaseModelEvent provides tag-based filtering for model events.
 * Tags are derived from the model's table name or the record's collection.
 */
export class BaseModelEvent extends Event implements Tagger {
  declare model: Model | null

  constructor(model: Model | null) {
    super()
    this.model = model
  }

  /** Returns tags for this event: collection id/name or table name. */
  tags(): string[] {
    if (!this.model) return []
    // For now, use table name as the tag
    const tableName = this.model.tableName()
    if (tableName) return [tableName]
    return []
  }
}

/**
 * BaseCollectionEvent provides tag-based filtering for collection events.
 * Tags are derived from the collection's id and name.
 */
export class BaseCollectionEvent extends Event implements Tagger {
  declare collectionId: string
  declare collectionName: string

  constructor(
    collectionId: string,
    collectionName: string,
  ) {
    super()
    this.collectionId = collectionId
    this.collectionName = collectionName
  }

  /** Returns tags for this event: [collectionId, collectionName]. */
  tags(): string[] {
    const tags: string[] = []
    if (this.collectionId) tags.push(this.collectionId)
    if (this.collectionName) tags.push(this.collectionName)
    return tags
  }
}

// -------------------------------------------------------------------
// App lifecycle events
// -------------------------------------------------------------------

/** BootstrapEvent is triggered during app initialization. */
export class BootstrapEvent extends Event {
  declare app: unknown

  constructor(app: unknown) {
    super()
    this.app = app
  }
}

/** TerminateEvent is triggered when the app is shutting down. */
export class TerminateEvent extends Event {
  declare app: unknown
  declare isRestart: boolean

  constructor(
    app: unknown,
    isRestart = false,
  ) {
    super()
    this.app = app
    this.isRestart = isRestart
  }
}

/** ServeEvent is triggered when the web server starts. */
export class ServeEvent extends Event {
  declare app: unknown
  declare router: unknown
  declare server: unknown

  constructor(
    app: unknown,
    router: unknown,
    server: unknown,
  ) {
    super()
    this.app = app
    this.router = router
    this.server = server
  }
}

/** BackupEvent is triggered during backup create/restore. */
export class BackupEvent extends Event {
  declare app: unknown
  declare name: string

  constructor(
    app: unknown,
    name: string,
  ) {
    super()
    this.app = app
    this.name = name
  }
}

// -------------------------------------------------------------------
// Model DAO events
// -------------------------------------------------------------------

/** ModelEvent is triggered for model-level CRUD operations. */
export class ModelEvent extends BaseModelEvent {
  declare dao?: unknown

  constructor(
    model: Model | null,
    dao?: unknown,
  ) {
    super(model)
    this.dao = dao
  }
}

/** ModelErrorEvent is triggered on model operation failure. */
export class ModelErrorEvent extends BaseModelEvent {
  declare error: Error

  constructor(
    model: Model | null,
    error: Error,
  ) {
    super(model)
    this.error = error
  }
}

// -------------------------------------------------------------------
// Record events
// -------------------------------------------------------------------

/** RecordEvent is a proxy for model events scoped to records. */
export class RecordEvent extends BaseModelEvent {
  declare record?: unknown

  constructor(
    model: Model | null,
    record?: unknown,
  ) {
    super(model)
    this.record = record
  }
}

/** RecordErrorEvent is triggered on record operation failure. */
export class RecordErrorEvent extends BaseModelEvent {
  declare error: Error
  declare record?: unknown

  constructor(
    model: Model | null,
    error: Error,
    record?: unknown,
  ) {
    super(model)
    this.error = error
    this.record = record
  }
}

/** RecordEnrichEvent is triggered when a record is enriched for API response. */
export class RecordEnrichEvent extends BaseModelEvent {
  declare record?: unknown
  declare requestInfo?: unknown

  constructor(
    model: Model | null,
    record?: unknown,
    requestInfo?: unknown,
  ) {
    super(model)
    this.record = record
    this.requestInfo = requestInfo
  }
}

// -------------------------------------------------------------------
// Collection events
// -------------------------------------------------------------------

/** CollectionEvent is a proxy for model events scoped to collections. */
export class CollectionEvent extends BaseCollectionEvent {
  declare collection?: unknown

  constructor(
    collectionId: string,
    collectionName: string,
    collection?: unknown,
  ) {
    super(collectionId, collectionName)
    this.collection = collection
  }
}

/** CollectionErrorEvent is triggered on collection operation failure. */
export class CollectionErrorEvent extends BaseCollectionEvent {
  declare error: Error

  constructor(
    collectionId: string,
    collectionName: string,
    error: Error,
  ) {
    super(collectionId, collectionName)
    this.error = error
  }
}

// -------------------------------------------------------------------
// Mailer events
// -------------------------------------------------------------------

/** MailerEvent is triggered when an email is being sent. */
export class MailerEvent extends Event {
  declare mailClient: unknown
  declare message: unknown

  constructor(
    mailClient: unknown,
    message: unknown,
  ) {
    super()
    this.mailClient = mailClient
    this.message = message
  }
}

/** MailerRecordEvent is triggered when a record-related email is being sent. */
export class MailerRecordEvent extends BaseCollectionEvent {
  declare mailClient: unknown
  declare message: unknown
  declare record?: unknown
  declare meta?: Record<string, unknown>

  constructor(
    collectionId: string,
    collectionName: string,
    mailClient: unknown,
    message: unknown,
    record?: unknown,
    meta?: Record<string, unknown>,
  ) {
    super(collectionId, collectionName)
    this.mailClient = mailClient
    this.message = message
    this.record = record
    this.meta = meta
  }
}

// -------------------------------------------------------------------
// Realtime API events
// -------------------------------------------------------------------

/** RealtimeConnectEvent is triggered on SSE client connection. */
export class RealtimeConnectEvent extends Event {
  declare httpContext: unknown
  declare client: unknown
  declare idleTimeout?: number

  constructor(
    httpContext: unknown,
    client: unknown,
    idleTimeout?: number,
  ) {
    super()
    this.httpContext = httpContext
    this.client = client
    this.idleTimeout = idleTimeout
  }
}

/** RealtimeDisconnectEvent is triggered on SSE client disconnection. */
export class RealtimeDisconnectEvent extends Event {
  declare httpContext: unknown
  declare client: unknown

  constructor(
    httpContext: unknown,
    client: unknown,
  ) {
    super()
    this.httpContext = httpContext
    this.client = client
  }
}

/** RealtimeMessageEvent is triggered when sending an SSE message. */
export class RealtimeMessageEvent extends Event {
  declare httpContext: unknown
  declare client: unknown
  declare message: unknown

  constructor(
    httpContext: unknown,
    client: unknown,
    message: unknown,
  ) {
    super()
    this.httpContext = httpContext
    this.client = client
    this.message = message
  }
}

/** RealtimeSubscribeEvent is triggered on subscription changes. */
export class RealtimeSubscribeEvent extends Event {
  declare httpContext: unknown
  declare client: unknown
  declare subscriptions: string[]

  constructor(
    httpContext: unknown,
    client: unknown,
    subscriptions: string[],
  ) {
    super()
    this.httpContext = httpContext
    this.client = client
    this.subscriptions = subscriptions
  }
}

/** RealtimeSubscribeRequestEvent is the API request variant. */
export class RealtimeSubscribeRequestEvent extends Event {
  declare httpContext: unknown
  declare client: unknown
  declare subscriptions: string[]

  constructor(
    httpContext: unknown,
    client: unknown,
    subscriptions: string[],
  ) {
    super()
    this.httpContext = httpContext
    this.client = client
    this.subscriptions = subscriptions
  }
}

// -------------------------------------------------------------------
// Settings API events
// -------------------------------------------------------------------

/** SettingsListEvent is triggered on settings list API request. */
export class SettingsListEvent extends Event {
  declare httpContext: unknown
  declare redactedSettings?: unknown

  constructor(
    httpContext: unknown,
    redactedSettings?: unknown,
  ) {
    super()
    this.httpContext = httpContext
    this.redactedSettings = redactedSettings
  }
}

/** SettingsUpdateEvent is triggered on settings update API request. */
export class SettingsUpdateEvent extends Event {
  declare httpContext: unknown
  declare oldSettings?: unknown
  declare newSettings?: unknown

  constructor(
    httpContext: unknown,
    oldSettings?: unknown,
    newSettings?: unknown,
  ) {
    super()
    this.httpContext = httpContext
    this.oldSettings = oldSettings
    this.newSettings = newSettings
  }
}

/** SettingsReloadEvent is triggered on settings reload. */
export class SettingsReloadEvent extends Event {
  declare oldSettings?: unknown
  declare newSettings?: unknown

  constructor(oldSettings?: unknown, newSettings?: unknown) {
    super()
    this.oldSettings = oldSettings
    this.newSettings = newSettings
  }
}

// -------------------------------------------------------------------
// Record CRUD API events
// -------------------------------------------------------------------

/** RecordsListEvent is triggered on records list API request. */
export class RecordsListEvent extends BaseCollectionEvent {
  declare httpContext: unknown
  declare records?: unknown[]
  declare result?: unknown

  constructor(
    collectionId: string,
    collectionName: string,
    httpContext: unknown,
    records?: unknown[],
    result?: unknown,
  ) {
    super(collectionId, collectionName)
    this.httpContext = httpContext
    this.records = records
    this.result = result
  }
}

/** RecordRequestEvent is triggered for record CRUD API requests. */
export class RecordRequestEvent extends BaseCollectionEvent {
  declare httpContext: unknown
  declare record?: unknown

  constructor(
    collectionId: string,
    collectionName: string,
    httpContext: unknown,
    record?: unknown,
  ) {
    super(collectionId, collectionName)
    this.httpContext = httpContext
    this.record = record
  }
}

/** RecordViewEvent is triggered on record view API request. */
export class RecordViewEvent extends BaseCollectionEvent {
  declare httpContext: unknown
  declare record?: unknown

  constructor(
    collectionId: string,
    collectionName: string,
    httpContext: unknown,
    record?: unknown,
  ) {
    super(collectionId, collectionName)
    this.httpContext = httpContext
    this.record = record
  }
}

/** RecordCreateEvent is triggered on record create API request. */
export class RecordCreateEvent extends BaseCollectionEvent {
  declare httpContext: unknown
  declare record?: unknown
  declare uploadedFiles?: Record<string, unknown[]>

  constructor(
    collectionId: string,
    collectionName: string,
    httpContext: unknown,
    record?: unknown,
    uploadedFiles?: Record<string, unknown[]>,
  ) {
    super(collectionId, collectionName)
    this.httpContext = httpContext
    this.record = record
    this.uploadedFiles = uploadedFiles
  }
}

/** RecordUpdateEvent is triggered on record update API request. */
export class RecordUpdateEvent extends BaseCollectionEvent {
  declare httpContext: unknown
  declare record?: unknown
  declare uploadedFiles?: Record<string, unknown[]>

  constructor(
    collectionId: string,
    collectionName: string,
    httpContext: unknown,
    record?: unknown,
    uploadedFiles?: Record<string, unknown[]>,
  ) {
    super(collectionId, collectionName)
    this.httpContext = httpContext
    this.record = record
    this.uploadedFiles = uploadedFiles
  }
}

/** RecordDeleteEvent is triggered on record delete API request. */
export class RecordDeleteEvent extends BaseCollectionEvent {
  declare httpContext: unknown
  declare record?: unknown

  constructor(
    collectionId: string,
    collectionName: string,
    httpContext: unknown,
    record?: unknown,
  ) {
    super(collectionId, collectionName)
    this.httpContext = httpContext
    this.record = record
  }
}

// -------------------------------------------------------------------
// Auth Record API events
// -------------------------------------------------------------------

/** RecordAuthEvent is triggered on successful record authentication. */
export class RecordAuthEvent extends BaseCollectionEvent {
  declare httpContext: unknown
  declare record?: unknown
  declare token?: string
  declare meta?: unknown

  constructor(
    collectionId: string,
    collectionName: string,
    httpContext: unknown,
    record?: unknown,
    token?: string,
    meta?: unknown,
  ) {
    super(collectionId, collectionName)
    this.httpContext = httpContext
    this.record = record
    this.token = token
    this.meta = meta
  }
}

/** RecordAuthRequestEvent is the RecordAuthEvent variant for API. */
export class RecordAuthRequestEvent extends BaseCollectionEvent {
  declare httpContext: unknown
  declare record?: unknown
  declare token?: string

  constructor(
    collectionId: string,
    collectionName: string,
    httpContext: unknown,
    record?: unknown,
    token?: string,
  ) {
    super(collectionId, collectionName)
    this.httpContext = httpContext
    this.record = record
    this.token = token
  }
}

/** RecordAuthWithPasswordEvent is triggered on password login. */
export class RecordAuthWithPasswordEvent extends BaseCollectionEvent {
  declare httpContext: unknown
  declare record?: unknown
  declare identity?: string
  declare password?: string

  constructor(
    collectionId: string,
    collectionName: string,
    httpContext: unknown,
    record?: unknown,
    identity?: string,
    password?: string,
  ) {
    super(collectionId, collectionName)
    this.httpContext = httpContext
    this.record = record
    this.identity = identity
    this.password = password
  }
}

/** RecordAuthWithOAuth2Event is triggered on OAuth2 login. */
export class RecordAuthWithOAuth2Event extends BaseCollectionEvent {
  declare httpContext: unknown
  declare providerName?: string
  declare providerClient?: unknown
  declare record?: unknown
  declare oAuth2User?: unknown
  declare isNewRecord?: boolean

  constructor(
    collectionId: string,
    collectionName: string,
    httpContext: unknown,
    providerName?: string,
    providerClient?: unknown,
    record?: unknown,
    oAuth2User?: unknown,
    isNewRecord?: boolean,
  ) {
    super(collectionId, collectionName)
    this.httpContext = httpContext
    this.providerName = providerName
    this.providerClient = providerClient
    this.record = record
    this.oAuth2User = oAuth2User
    this.isNewRecord = isNewRecord
  }
}

/** RecordAuthRefreshEvent is triggered on auth token refresh. */
export class RecordAuthRefreshEvent extends BaseCollectionEvent {
  declare httpContext: unknown
  declare record?: unknown

  constructor(
    collectionId: string,
    collectionName: string,
    httpContext: unknown,
    record?: unknown,
  ) {
    super(collectionId, collectionName)
    this.httpContext = httpContext
    this.record = record
  }
}

/** RecordRequestPasswordResetEvent is triggered on password reset request. */
export class RecordRequestPasswordResetEvent extends BaseCollectionEvent {
  declare httpContext: unknown
  declare record?: unknown

  constructor(
    collectionId: string,
    collectionName: string,
    httpContext: unknown,
    record?: unknown,
  ) {
    super(collectionId, collectionName)
    this.httpContext = httpContext
    this.record = record
  }
}

/** RecordConfirmPasswordResetEvent is triggered on password reset confirm. */
export class RecordConfirmPasswordResetEvent extends BaseCollectionEvent {
  declare httpContext: unknown
  declare record?: unknown

  constructor(
    collectionId: string,
    collectionName: string,
    httpContext: unknown,
    record?: unknown,
  ) {
    super(collectionId, collectionName)
    this.httpContext = httpContext
    this.record = record
  }
}

/** RecordRequestVerificationEvent is triggered on verification request. */
export class RecordRequestVerificationEvent extends BaseCollectionEvent {
  declare httpContext: unknown
  declare record?: unknown

  constructor(
    collectionId: string,
    collectionName: string,
    httpContext: unknown,
    record?: unknown,
  ) {
    super(collectionId, collectionName)
    this.httpContext = httpContext
    this.record = record
  }
}

/** RecordConfirmVerificationEvent is triggered on verification confirm. */
export class RecordConfirmVerificationEvent extends BaseCollectionEvent {
  declare httpContext: unknown
  declare record?: unknown

  constructor(
    collectionId: string,
    collectionName: string,
    httpContext: unknown,
    record?: unknown,
  ) {
    super(collectionId, collectionName)
    this.httpContext = httpContext
    this.record = record
  }
}

/** RecordRequestEmailChangeEvent is triggered on email change request. */
export class RecordRequestEmailChangeEvent extends BaseCollectionEvent {
  declare httpContext: unknown
  declare record?: unknown

  constructor(
    collectionId: string,
    collectionName: string,
    httpContext: unknown,
    record?: unknown,
  ) {
    super(collectionId, collectionName)
    this.httpContext = httpContext
    this.record = record
  }
}

/** RecordConfirmEmailChangeEvent is triggered on email change confirm. */
export class RecordConfirmEmailChangeEvent extends BaseCollectionEvent {
  declare httpContext: unknown
  declare record?: unknown

  constructor(
    collectionId: string,
    collectionName: string,
    httpContext: unknown,
    record?: unknown,
  ) {
    super(collectionId, collectionName)
    this.httpContext = httpContext
    this.record = record
  }
}

/** RecordCreateOTPRequestEvent is triggered on OTP creation request. */
export class RecordCreateOTPRequestEvent extends BaseCollectionEvent {
  declare httpContext: unknown
  declare record?: unknown

  constructor(
    collectionId: string,
    collectionName: string,
    httpContext: unknown,
    record?: unknown,
  ) {
    super(collectionId, collectionName)
    this.httpContext = httpContext
    this.record = record
  }
}

/** RecordAuthWithOTPRequestEvent is triggered on OTP auth request. */
export class RecordAuthWithOTPRequestEvent extends BaseCollectionEvent {
  declare httpContext: unknown
  declare record?: unknown

  constructor(
    collectionId: string,
    collectionName: string,
    httpContext: unknown,
    record?: unknown,
  ) {
    super(collectionId, collectionName)
    this.httpContext = httpContext
    this.record = record
  }
}

// -------------------------------------------------------------------
// Collection API events
// -------------------------------------------------------------------

/** CollectionsListEvent is triggered on collections list request. */
export class CollectionsListEvent extends Event {
  declare httpContext: unknown
  declare collections?: unknown[]
  declare result?: unknown

  constructor(
    httpContext: unknown,
    collections?: unknown[],
    result?: unknown,
  ) {
    super()
    this.httpContext = httpContext
    this.collections = collections
    this.result = result
  }
}

/** CollectionRequestEvent is triggered for collection CRUD API requests. */
export class CollectionRequestEvent extends BaseCollectionEvent {
  declare httpContext: unknown

  constructor(
    collectionId: string,
    collectionName: string,
    httpContext: unknown,
  ) {
    super(collectionId, collectionName)
    this.httpContext = httpContext
  }
}

/** CollectionCreateEvent is triggered on collection create. */
export class CollectionCreateEvent extends BaseCollectionEvent {
  declare httpContext: unknown

  constructor(
    collectionId: string,
    collectionName: string,
    httpContext: unknown,
  ) {
    super(collectionId, collectionName)
    this.httpContext = httpContext
  }
}

/** CollectionUpdateEvent is triggered on collection update. */
export class CollectionUpdateEvent extends BaseCollectionEvent {
  declare httpContext: unknown

  constructor(
    collectionId: string,
    collectionName: string,
    httpContext: unknown,
  ) {
    super(collectionId, collectionName)
    this.httpContext = httpContext
  }
}

/** CollectionDeleteEvent is triggered on collection delete. */
export class CollectionDeleteEvent extends BaseCollectionEvent {
  declare httpContext: unknown

  constructor(
    collectionId: string,
    collectionName: string,
    httpContext: unknown,
  ) {
    super(collectionId, collectionName)
    this.httpContext = httpContext
  }
}

/** CollectionsImportRequestEvent is triggered on collections import. */
export class CollectionsImportRequestEvent extends Event {
  declare httpContext: unknown
  declare collections?: unknown[]

  constructor(
    httpContext: unknown,
    collections?: unknown[],
  ) {
    super()
    this.httpContext = httpContext
    this.collections = collections
  }
}

// -------------------------------------------------------------------
// File API events
// -------------------------------------------------------------------

/** FileTokenEvent is triggered on file token API request. */
export class FileTokenEvent extends BaseModelEvent {
  declare httpContext: unknown
  declare token?: string

  constructor(
    model: Model | null,
    httpContext: unknown,
    token?: string,
  ) {
    super(model)
    this.httpContext = httpContext
    this.token = token
  }
}

/** FileTokenRequestEvent is a variant for file token requests. */
export class FileTokenRequestEvent extends BaseModelEvent {
  declare httpContext: unknown
  declare token?: string

  constructor(
    model: Model | null,
    httpContext: unknown,
    token?: string,
  ) {
    super(model)
    this.httpContext = httpContext
    this.token = token
  }
}

/** FileDownloadEvent is triggered on file download request. */
export class FileDownloadEvent extends BaseCollectionEvent {
  declare httpContext: unknown
  declare record?: unknown
  declare fileField?: unknown
  declare servedPath?: string
  declare servedName?: string

  constructor(
    collectionId: string,
    collectionName: string,
    httpContext: unknown,
    record?: unknown,
    fileField?: unknown,
    servedPath?: string,
    servedName?: string,
  ) {
    super(collectionId, collectionName)
    this.httpContext = httpContext
    this.record = record
    this.fileField = fileField
    this.servedPath = servedPath
    this.servedName = servedName
  }
}

/** FileDownloadRequestEvent is triggered on file download API request. */
export class FileDownloadRequestEvent extends BaseCollectionEvent {
  declare httpContext: unknown
  declare record?: unknown

  constructor(
    collectionId: string,
    collectionName: string,
    httpContext: unknown,
    record?: unknown,
  ) {
    super(collectionId, collectionName)
    this.httpContext = httpContext
    this.record = record
  }
}

// -------------------------------------------------------------------
// Batch API events
// -------------------------------------------------------------------

/** BatchRequestEvent is triggered on batch API request. */
export class BatchRequestEvent extends Event {
  declare httpContext: unknown
  declare requests?: unknown[]
  declare responses?: unknown[]

  constructor(
    httpContext: unknown,
    requests?: unknown[],
    responses?: unknown[],
  ) {
    super()
    this.httpContext = httpContext
    this.requests = requests
    this.responses = responses
  }
}

// -------------------------------------------------------------------
// UI Extension type
// -------------------------------------------------------------------

/**
 * UIExtension defines a PocketBase admin UI extension.
 *
 * Each extension provides HTML snippets that are injected into
 * specific admin UI pages.
 */
export interface UIExtension {
  /** Where to inject the content: "head", "bodyTop", "bodyBottom". */
  location: 'head' | 'bodyTop' | 'bodyBottom'

  /** The HTML content to inject. */
  html: string

  /** Optional list of page patterns where this extension applies. */
  pages?: string[]
}
