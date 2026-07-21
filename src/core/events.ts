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
  constructor(public model: Model | null) {
    super()
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
  constructor(
    public collectionId: string,
    public collectionName: string,
  ) {
    super()
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
  constructor(public app: unknown) {
    super()
  }
}

/** TerminateEvent is triggered when the app is shutting down. */
export class TerminateEvent extends Event {
  constructor(
    public app: unknown,
    public isRestart = false,
  ) {
    super()
  }
}

/** ServeEvent is triggered when the web server starts. */
export class ServeEvent extends Event {
  constructor(
    public app: unknown,
    public router: unknown,
    public server: unknown,
  ) {
    super()
  }
}

/** BackupEvent is triggered during backup create/restore. */
export class BackupEvent extends Event {
  constructor(
    public app: unknown,
    public name: string,
  ) {
    super()
  }
}

// -------------------------------------------------------------------
// Model DAO events
// -------------------------------------------------------------------

/** ModelEvent is triggered for model-level CRUD operations. */
export class ModelEvent extends BaseModelEvent {
  constructor(
    model: Model | null,
    public dao?: unknown,
  ) {
    super(model)
  }
}

/** ModelErrorEvent is triggered on model operation failure. */
export class ModelErrorEvent extends BaseModelEvent {
  constructor(
    model: Model | null,
    public error: Error,
  ) {
    super(model)
  }
}

// -------------------------------------------------------------------
// Record events
// -------------------------------------------------------------------

/** RecordEvent is a proxy for model events scoped to records. */
export class RecordEvent extends BaseModelEvent {
  constructor(
    model: Model | null,
    public record?: unknown,
  ) {
    super(model)
  }
}

/** RecordErrorEvent is triggered on record operation failure. */
export class RecordErrorEvent extends BaseModelEvent {
  constructor(
    model: Model | null,
    public error: Error,
    public record?: unknown,
  ) {
    super(model)
  }
}

/** RecordEnrichEvent is triggered when a record is enriched for API response. */
export class RecordEnrichEvent extends BaseModelEvent {
  constructor(
    model: Model | null,
    public record?: unknown,
    public requestInfo?: unknown,
  ) {
    super(model)
  }
}

// -------------------------------------------------------------------
// Collection events
// -------------------------------------------------------------------

/** CollectionEvent is a proxy for model events scoped to collections. */
export class CollectionEvent extends BaseCollectionEvent {
  constructor(
    collectionId: string,
    collectionName: string,
    public collection?: unknown,
  ) {
    super(collectionId, collectionName)
  }
}

/** CollectionErrorEvent is triggered on collection operation failure. */
export class CollectionErrorEvent extends BaseCollectionEvent {
  constructor(
    collectionId: string,
    collectionName: string,
    public error: Error,
  ) {
    super(collectionId, collectionName)
  }
}

// -------------------------------------------------------------------
// Mailer events
// -------------------------------------------------------------------

/** MailerEvent is triggered when an email is being sent. */
export class MailerEvent extends Event {
  constructor(
    public mailClient: unknown,
    public message: unknown,
  ) {
    super()
  }
}

/** MailerRecordEvent is triggered when a record-related email is being sent. */
export class MailerRecordEvent extends BaseCollectionEvent {
  constructor(
    collectionId: string,
    collectionName: string,
    public mailClient: unknown,
    public message: unknown,
    public record?: unknown,
    public meta?: Record<string, unknown>,
  ) {
    super(collectionId, collectionName)
  }
}

// -------------------------------------------------------------------
// Realtime API events
// -------------------------------------------------------------------

/** RealtimeConnectEvent is triggered on SSE client connection. */
export class RealtimeConnectEvent extends Event {
  constructor(
    public httpContext: unknown,
    public client: unknown,
    public idleTimeout?: number,
  ) {
    super()
  }
}

/** RealtimeDisconnectEvent is triggered on SSE client disconnection. */
export class RealtimeDisconnectEvent extends Event {
  constructor(
    public httpContext: unknown,
    public client: unknown,
  ) {
    super()
  }
}

/** RealtimeMessageEvent is triggered when sending an SSE message. */
export class RealtimeMessageEvent extends Event {
  constructor(
    public httpContext: unknown,
    public client: unknown,
    public message: unknown,
  ) {
    super()
  }
}

/** RealtimeSubscribeEvent is triggered on subscription changes. */
export class RealtimeSubscribeEvent extends Event {
  constructor(
    public httpContext: unknown,
    public client: unknown,
    public subscriptions: string[],
  ) {
    super()
  }
}

/** RealtimeSubscribeRequestEvent is the API request variant. */
export class RealtimeSubscribeRequestEvent extends Event {
  constructor(
    public httpContext: unknown,
    public client: unknown,
    public subscriptions: string[],
  ) {
    super()
  }
}

// -------------------------------------------------------------------
// Settings API events
// -------------------------------------------------------------------

/** SettingsListEvent is triggered on settings list API request. */
export class SettingsListEvent extends Event {
  constructor(
    public httpContext: unknown,
    public redactedSettings?: unknown,
  ) {
    super()
  }
}

/** SettingsUpdateEvent is triggered on settings update API request. */
export class SettingsUpdateEvent extends Event {
  constructor(
    public httpContext: unknown,
    public oldSettings?: unknown,
    public newSettings?: unknown,
  ) {
    super()
  }
}

/** SettingsReloadEvent is triggered on settings reload. */
export class SettingsReloadEvent extends Event {
  constructor(public oldSettings?: unknown, public newSettings?: unknown) {
    super()
  }
}

// -------------------------------------------------------------------
// Record CRUD API events
// -------------------------------------------------------------------

/** RecordsListEvent is triggered on records list API request. */
export class RecordsListEvent extends BaseCollectionEvent {
  constructor(
    collectionId: string,
    collectionName: string,
    public httpContext: unknown,
    public records?: unknown[],
    public result?: unknown,
  ) {
    super(collectionId, collectionName)
  }
}

/** RecordRequestEvent is triggered for record CRUD API requests. */
export class RecordRequestEvent extends BaseCollectionEvent {
  constructor(
    collectionId: string,
    collectionName: string,
    public httpContext: unknown,
    public record?: unknown,
  ) {
    super(collectionId, collectionName)
  }
}

/** RecordViewEvent is triggered on record view API request. */
export class RecordViewEvent extends BaseCollectionEvent {
  constructor(
    collectionId: string,
    collectionName: string,
    public httpContext: unknown,
    public record?: unknown,
  ) {
    super(collectionId, collectionName)
  }
}

/** RecordCreateEvent is triggered on record create API request. */
export class RecordCreateEvent extends BaseCollectionEvent {
  constructor(
    collectionId: string,
    collectionName: string,
    public httpContext: unknown,
    public record?: unknown,
    public uploadedFiles?: Record<string, unknown[]>,
  ) {
    super(collectionId, collectionName)
  }
}

/** RecordUpdateEvent is triggered on record update API request. */
export class RecordUpdateEvent extends BaseCollectionEvent {
  constructor(
    collectionId: string,
    collectionName: string,
    public httpContext: unknown,
    public record?: unknown,
    public uploadedFiles?: Record<string, unknown[]>,
  ) {
    super(collectionId, collectionName)
  }
}

/** RecordDeleteEvent is triggered on record delete API request. */
export class RecordDeleteEvent extends BaseCollectionEvent {
  constructor(
    collectionId: string,
    collectionName: string,
    public httpContext: unknown,
    public record?: unknown,
  ) {
    super(collectionId, collectionName)
  }
}

// -------------------------------------------------------------------
// Auth Record API events
// -------------------------------------------------------------------

/** RecordAuthEvent is triggered on successful record authentication. */
export class RecordAuthEvent extends BaseCollectionEvent {
  constructor(
    collectionId: string,
    collectionName: string,
    public httpContext: unknown,
    public record?: unknown,
    public token?: string,
    public meta?: unknown,
  ) {
    super(collectionId, collectionName)
  }
}

/** RecordAuthRequestEvent is the RecordAuthEvent variant for API. */
export class RecordAuthRequestEvent extends BaseCollectionEvent {
  constructor(
    collectionId: string,
    collectionName: string,
    public httpContext: unknown,
    public record?: unknown,
    public token?: string,
  ) {
    super(collectionId, collectionName)
  }
}

/** RecordAuthWithPasswordEvent is triggered on password login. */
export class RecordAuthWithPasswordEvent extends BaseCollectionEvent {
  constructor(
    collectionId: string,
    collectionName: string,
    public httpContext: unknown,
    public record?: unknown,
    public identity?: string,
    public password?: string,
  ) {
    super(collectionId, collectionName)
  }
}

/** RecordAuthWithOAuth2Event is triggered on OAuth2 login. */
export class RecordAuthWithOAuth2Event extends BaseCollectionEvent {
  constructor(
    collectionId: string,
    collectionName: string,
    public httpContext: unknown,
    public providerName?: string,
    public providerClient?: unknown,
    public record?: unknown,
    public oAuth2User?: unknown,
    public isNewRecord?: boolean,
  ) {
    super(collectionId, collectionName)
  }
}

/** RecordAuthRefreshEvent is triggered on auth token refresh. */
export class RecordAuthRefreshEvent extends BaseCollectionEvent {
  constructor(
    collectionId: string,
    collectionName: string,
    public httpContext: unknown,
    public record?: unknown,
  ) {
    super(collectionId, collectionName)
  }
}

/** RecordRequestPasswordResetEvent is triggered on password reset request. */
export class RecordRequestPasswordResetEvent extends BaseCollectionEvent {
  constructor(
    collectionId: string,
    collectionName: string,
    public httpContext: unknown,
    public record?: unknown,
  ) {
    super(collectionId, collectionName)
  }
}

/** RecordConfirmPasswordResetEvent is triggered on password reset confirm. */
export class RecordConfirmPasswordResetEvent extends BaseCollectionEvent {
  constructor(
    collectionId: string,
    collectionName: string,
    public httpContext: unknown,
    public record?: unknown,
  ) {
    super(collectionId, collectionName)
  }
}

/** RecordRequestVerificationEvent is triggered on verification request. */
export class RecordRequestVerificationEvent extends BaseCollectionEvent {
  constructor(
    collectionId: string,
    collectionName: string,
    public httpContext: unknown,
    public record?: unknown,
  ) {
    super(collectionId, collectionName)
  }
}

/** RecordConfirmVerificationEvent is triggered on verification confirm. */
export class RecordConfirmVerificationEvent extends BaseCollectionEvent {
  constructor(
    collectionId: string,
    collectionName: string,
    public httpContext: unknown,
    public record?: unknown,
  ) {
    super(collectionId, collectionName)
  }
}

/** RecordRequestEmailChangeEvent is triggered on email change request. */
export class RecordRequestEmailChangeEvent extends BaseCollectionEvent {
  constructor(
    collectionId: string,
    collectionName: string,
    public httpContext: unknown,
    public record?: unknown,
  ) {
    super(collectionId, collectionName)
  }
}

/** RecordConfirmEmailChangeEvent is triggered on email change confirm. */
export class RecordConfirmEmailChangeEvent extends BaseCollectionEvent {
  constructor(
    collectionId: string,
    collectionName: string,
    public httpContext: unknown,
    public record?: unknown,
  ) {
    super(collectionId, collectionName)
  }
}

/** RecordCreateOTPRequestEvent is triggered on OTP creation request. */
export class RecordCreateOTPRequestEvent extends BaseCollectionEvent {
  constructor(
    collectionId: string,
    collectionName: string,
    public httpContext: unknown,
    public record?: unknown,
  ) {
    super(collectionId, collectionName)
  }
}

/** RecordAuthWithOTPRequestEvent is triggered on OTP auth request. */
export class RecordAuthWithOTPRequestEvent extends BaseCollectionEvent {
  constructor(
    collectionId: string,
    collectionName: string,
    public httpContext: unknown,
    public record?: unknown,
  ) {
    super(collectionId, collectionName)
  }
}

// -------------------------------------------------------------------
// Collection API events
// -------------------------------------------------------------------

/** CollectionsListEvent is triggered on collections list request. */
export class CollectionsListEvent extends Event {
  constructor(
    public httpContext: unknown,
    public collections?: unknown[],
    public result?: unknown,
  ) {
    super()
  }
}

/** CollectionRequestEvent is triggered for collection CRUD API requests. */
export class CollectionRequestEvent extends BaseCollectionEvent {
  constructor(
    collectionId: string,
    collectionName: string,
    public httpContext: unknown,
  ) {
    super(collectionId, collectionName)
  }
}

/** CollectionCreateEvent is triggered on collection create. */
export class CollectionCreateEvent extends BaseCollectionEvent {
  constructor(
    collectionId: string,
    collectionName: string,
    public httpContext: unknown,
  ) {
    super(collectionId, collectionName)
  }
}

/** CollectionUpdateEvent is triggered on collection update. */
export class CollectionUpdateEvent extends BaseCollectionEvent {
  constructor(
    collectionId: string,
    collectionName: string,
    public httpContext: unknown,
  ) {
    super(collectionId, collectionName)
  }
}

/** CollectionDeleteEvent is triggered on collection delete. */
export class CollectionDeleteEvent extends BaseCollectionEvent {
  constructor(
    collectionId: string,
    collectionName: string,
    public httpContext: unknown,
  ) {
    super(collectionId, collectionName)
  }
}

/** CollectionsImportRequestEvent is triggered on collections import. */
export class CollectionsImportRequestEvent extends Event {
  constructor(
    public httpContext: unknown,
    public collections?: unknown[],
  ) {
    super()
  }
}

// -------------------------------------------------------------------
// File API events
// -------------------------------------------------------------------

/** FileTokenEvent is triggered on file token API request. */
export class FileTokenEvent extends BaseModelEvent {
  constructor(
    model: Model | null,
    public httpContext: unknown,
    public token?: string,
  ) {
    super(model)
  }
}

/** FileTokenRequestEvent is a variant for file token requests. */
export class FileTokenRequestEvent extends BaseModelEvent {
  constructor(
    model: Model | null,
    public httpContext: unknown,
    public token?: string,
  ) {
    super(model)
  }
}

/** FileDownloadEvent is triggered on file download request. */
export class FileDownloadEvent extends BaseCollectionEvent {
  constructor(
    collectionId: string,
    collectionName: string,
    public httpContext: unknown,
    public record?: unknown,
    public fileField?: unknown,
    public servedPath?: string,
    public servedName?: string,
  ) {
    super(collectionId, collectionName)
  }
}

/** FileDownloadRequestEvent is triggered on file download API request. */
export class FileDownloadRequestEvent extends BaseCollectionEvent {
  constructor(
    collectionId: string,
    collectionName: string,
    public httpContext: unknown,
    public record?: unknown,
  ) {
    super(collectionId, collectionName)
  }
}

// -------------------------------------------------------------------
// Batch API events
// -------------------------------------------------------------------

/** BatchRequestEvent is triggered on batch API request. */
export class BatchRequestEvent extends Event {
  constructor(
    public httpContext: unknown,
    public requests?: unknown[],
    public responses?: unknown[],
  ) {
    super()
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
