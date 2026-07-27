/**
 * BaseModel — shared embedded model for Collection and Record.
 *
 * Port of PocketBase's core/base_model.go (Go -> TypeScript).
 * Layer 2 — imports from ~/tools/types.
 */

import { DateTime } from '~/tools/types/datetime.ts'

// ---------------------------------------------------------------------------
// Sentinel PK value for new (unsaved) models
// ---------------------------------------------------------------------------

/** PK placeholder used for new models that haven't been persisted yet. */
export const UnsavedPK = ''

// ---------------------------------------------------------------------------
// BaseModel
// ---------------------------------------------------------------------------

/**
 * BaseModel is the embedded base for every app model (Collection, Record, etc.).
 *
 * Provides:
 *  - `id`, `created`, `updated` timestamps
 *  - `isNew` / `lastSavedPK` bookkeeping
 *  - Copy/clone helpers
 *
 * Equivalent to PocketBase's `core.BaseModel`.
 */
export class BaseModel {
  // ---- persisted columns ------------------------------------------------
  id: string = ''
  created: DateTime = new DateTime(null)
  updated: DateTime = new DateTime(null)

  // ---- transient bookkeeping --------------------------------------------
  protected lastSavedPK: string = UnsavedPK
  private autogenerateId: boolean = true
  private _isNew: boolean = true

  // -----------------------------------------------------------------------
  // Id helpers
  // -----------------------------------------------------------------------

  /** Whether the model has a non-empty id. */
  hasId(): boolean {
    return this.id !== ''
  }

  /** Returns `id` (alias for the field accessor). */
  getId(): string {
    return this.id
  }

  /**
   * Sets a new id on the model.
   * If `id` is empty and the model is new, autogeneration is re-enabled.
   */
  setId(id: string): void {
    this.id = id
    if (id === '' && this._isNew) {
      this.autogenerateId = true
    } else {
      this.autogenerateId = false
    }
  }

  /**
   * Refreshes the id by generating a new one.
   * Equivalent to Go's `BaseModel.RefreshId()`.
   */
  refreshId(): void {
    this.id = this.generateId()
    this.autogenerateId = false
  }

  /**
   * Returns the last saved primary key value.
   * For new models this will be an empty string.
   */
  lastSavedPKValue(): string {
    return this.lastSavedPK
  }

  // -----------------------------------------------------------------------
  // New / saved state
  // -----------------------------------------------------------------------

  /** Whether the model has not yet been persisted. */
  isNew(): boolean {
    return this._isNew
  }

  /** Mark the model as new (not yet persisted). */
  markAsNew(): void {
    this._isNew = true
    this.lastSavedPK = UnsavedPK
    this.autogenerateId = true
  }

  /** Mark the model as existing (already persisted). */
  markAsNotNew(): void {
    this._isNew = false
    this.lastSavedPK = this.id
    this.autogenerateId = false
  }

  // -----------------------------------------------------------------------
  // Post-scan hook
  // -----------------------------------------------------------------------

  /**
   * Called after loading from the database.
   * Refreshes the original state so that subsequent comparisons work correctly.
   */
  postScan(): void {
    if (!this.id) {
      throw new Error('missing primary key')
    }
    this.markAsNotNew()
  }

  // -----------------------------------------------------------------------
  // Id generation
  // -----------------------------------------------------------------------

  /**
   * Generate a new record id.
   *
   * Override in subclasses to provide custom id generation.
   * The default generates an 8-byte random hex id prefixed with a character.
   */
  protected generateId(): string {
    // Matches PocketBase's default "r" + 14 hex chars (7 random bytes)
    const randomBytes = crypto.getRandomValues(new Uint8Array(7))
    let hex = ''
    for (const b of randomBytes) {
      hex += b.toString(16).padStart(2, '0')
    }
    return `r${hex}`
  }

  // -----------------------------------------------------------------------
  // Clone
  // -----------------------------------------------------------------------

  /**
   * Creates a shallow copy of BaseModel state into the provided target.
   *
   * @param target - The object to copy state into.
   */
  protected cloneInto(target: BaseModel): void {
    target.id = this.id
    target.created = this.created
    target.updated = this.updated
    target.lastSavedPK = this.lastSavedPK
    target.autogenerateId = this.autogenerateId
    target._isNew = this._isNew
  }
}
