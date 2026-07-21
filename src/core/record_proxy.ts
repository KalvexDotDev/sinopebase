/**
 * RecordProxy interface — allows typed access to record data.
 *
 * Port of PocketBase's core/record_proxy.go (Go -> TypeScript).
 * Layer 2 — imports from ~/core/record_model.
 */

import type { Record } from '~/core/record_model.ts'

// ---------------------------------------------------------------------------
// RecordProxy
// ---------------------------------------------------------------------------

/**
 * RecordProxy provides typed access to a Record's data fields.
 *
 * In PocketBase Go this is an interface implemented by generated
 * models from the Go code generator. Each generated type (e.g.,
 * `UsersRecord`, `PostsRecord`) implements RecordProxy to provide
 * typed getters/setters for the collection's fields.
 *
 * In TypeScript, this interface serves the same purpose: concrete
 * proxy implementations can provide strongly-typed field access
 * while delegating storage to a Record instance.
 *
 * @example
 * ```ts
 * class UsersRecord implements RecordProxy {
 *   // The underlying record
 *   get collection(): Collection { ... }
 *
 *   // Typed accessors
 *   get email(): string { return this.proxyGet('email') }
 *   set email(v: string) { this.proxySet('email', v) }
 *
 *   get name(): string { return this.proxyGet('name') }
 *   set name(v: string) { this.proxySet('name', v) }
 * }
 * ```
 */
export interface RecordProxy {
  /** The underlying Record instance. */
  getRecord(): Record

  /** The collection this proxy belongs to. */
  getCollection(): import('~/core/collection_model.ts').Collection

  /** The record id. */
  id: string

  /**
   * Retrieves a raw value from the underlying record.
   */
  proxyGet(key: string): unknown

  /**
   * Sets a raw value on the underlying record.
   */
  proxySet(key: string, value: unknown): void
}

// ---------------------------------------------------------------------------
// BaseRecordProxy
// ---------------------------------------------------------------------------

/**
 * BaseRecordProxy provides a default implementation of RecordProxy.
 *
 * Proxy implementations should extend this class rather than implementing
 * RecordProxy directly.
 */
export class BaseRecordProxy implements RecordProxy {
  protected record: Record

  constructor(record: Record) {
    this.record = record
  }

  getRecord(): Record {
    return this.record
  }

  getCollection(): import('~/core/collection_model.ts').Collection {
    return this.record.collection
  }

  get id(): string {
    return this.record.id
  }

  set id(value: string) {
    this.record.id = value
  }

  proxyGet(key: string): unknown {
    return this.record.get(key)
  }

  proxySet(key: string, value: unknown): void {
    this.record.set(key, value)
  }

  /**
   * Returns the public export of the underlying record.
   */
  toJSON(): Record<string, unknown> {
    return this.record.toJSON()
  }
}
