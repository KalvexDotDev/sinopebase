/**
 * Record model — represents a single data row in a collection.
 *
 * Port of PocketBase's core/record_model.go (Go -> TypeScript).
 * Layer 2 — imports from ~/tools/* and ~/core/*.
 */

import { BaseModel } from '~/core/db_model.ts'
import type { Field } from '~/core/field.ts'
import {
  FieldNameId,
  FieldNameCollectionId,
  FieldNameCollectionName,
  FieldNameExpand,
  FieldNamePassword,
  FieldNameTokenKey,
  FieldNameEmail,
  FieldNameEmailVisibility,
  FieldNameVerified,
} from '~/core/field.ts'
import type { Collection } from '~/core/collection_model.ts'
import { DateTime } from '~/tools/types/datetime.ts'
import { Store } from '~/tools/store/store.ts'
import type { GeoPoint } from '~/tools/types/geo_point.ts'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Prefix used for internal custom field keys (kept private). */
const InternalCustomFieldKeyPrefix = '@pbInternal'

// ---------------------------------------------------------------------------
// Record
// ---------------------------------------------------------------------------

/**
 * The last saved primary key value. Used for tracking changes.
 */
const UnsavedPK = ''

/**
 * Record represents a single data row in a PocketBase collection.
 *
 * Equivalent to Go's `core.Record`.
 */
export class Record extends BaseModel {
  /** The collection this record belongs to. */
  readonly collection: Collection

  /** The data store holding all field values. */
  protected dataStore: Store<string, unknown>

  /** The original data as loaded from the database (for change tracking). */
  protected originalData: Map<string, unknown>

  /** Expanded relation data (populated by ExpandRecord). */
  protected expandStore: Store<string, unknown> | null = null

  /** Custom per-field visibility overrides. */
  protected customVisibilityStore: Store<string, boolean> = new Store()

  /** Whether to include custom (non-collection) data in exports. */
  exportCustomData: boolean = false

  /** Whether to ignore the email visibility check for auth records. */
  ignoreEmailVisibility: boolean = false

  /** Whether to skip unchanged fields in DB export (update optimization). */
  ignoreUnchangedFields: boolean = false

  /** Tracks the last saved primary key value for change detection. */
  protected lastSavedPK: string = UnsavedPK

  constructor(collection: Collection) {
    super()
    this.collection = collection
    this.dataStore = new Store()
    this.originalData = new Map()

    // Initialize default field values
    for (const field of collection.fields) {
      const fieldName = field.name
      if (fieldName === FieldNameId) continue
      const defaultValue = this.defaultValueForField(field)
      this.originalData.set(fieldName, defaultValue)
    }
  }

  /**
   * Returns the table name for this record (same as the collection name).
   */
  override tableName(): string {
    return this.collection.name
  }

  /**
   * Returns the last saved primary key value.
   */
  lastSavedPKValue(): string {
    return this.lastSavedPK
  }

  /**
   * Returns the storage directory path used by the record's files.
   */
  baseFilesPath(): string {
    const id = this.lastSavedPKValue() || this.id
    return `${this.collection.baseFilesPath()}/${id}`
  }

  // -----------------------------------------------------------------------
  // Post-scan
  // -----------------------------------------------------------------------

  /**
   * Called after loading from the database.
   * Refreshes the original data to match current data.
   */
  override postScan(): void {
    if (!this.id) {
      throw new Error('missing record primary key')
    }
    super.postScan()
    this.lastSavedPK = this.id
    this.originalData = this.fieldsData()
  }

  // -----------------------------------------------------------------------
  // Data access
  // -----------------------------------------------------------------------

  /**
   * Returns a raw value from the data store without any field normalizations.
   *
   * Equivalent to Go's `Record.GetRaw(key)`.
   */
  getRaw(key: string): unknown {
    if (key === FieldNameId) {
      return this.id
    }

    // Check mutable data store first
    const dataVal = this.dataStore.get(key)
    if (dataVal !== undefined) {
      return dataVal
    }

    // Fall back to original data
    return this.originalData.get(key)
  }

  /**
   * Sets a raw value directly WITHOUT normalizations.
   *
   * Equivalent to Go's `Record.SetRaw(key, value)`.
   */
  setRaw(key: string, value: unknown): void {
    if (key === FieldNameId) {
      this.id = String(value ?? '')
    }
    this.dataStore.set(key, value)
  }

  /**
   * Returns a normalized value for the given field key.
   *
   * Equivalent to Go's `Record.Get(key)`.
   */
  get(key: string): unknown {
    if (key === FieldNameExpand) {
      return this.expandData()
    }

    // Check for custom getters on collection fields
    for (const field of this.collection.fields) {
      if (field.name === key) {
        return this.getRaw(key)
      }
    }

    return this.getRaw(key)
  }

  /**
   * Sets a value, applying field normalizations if the key matches
   * a collection field.
   *
   * Equivalent to Go's `Record.Set(key, value)`.
   */
  set(key: string, value: unknown): void {
    if (key === FieldNameExpand) {
      if (typeof value === 'object' && value !== null) {
        this.setExpand(value as Record<string, unknown>)
      }
      return
    }

    // Check if this is a known collection field
    const field = this.collection.fields.getByName(key)
    if (field) {
      const normalized = this.normalizeValue(field, value)
      this.setRaw(key, normalized)
    } else {
      // Custom key — set without transformation
      this.setRaw(key, value)
    }
  }

  /**
   * Bulk loads data into the record.
   *
   * Equivalent to Go's `Record.Load(data)`.
   */
  load(data: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(data)) {
      this.set(key, value)
    }
  }

  // -----------------------------------------------------------------------
  // Typed getters
  // -----------------------------------------------------------------------

  /** Returns a string value. */
  getString(key: string): string {
    return String(this.get(key) ?? '')
  }

  /** Returns a boolean value. */
  getBool(key: string): boolean {
    const v = this.get(key)
    if (typeof v === 'boolean') return v
    if (typeof v === 'string') return v === 'true' || v === '1'
    if (typeof v === 'number') return v !== 0
    return false
  }

  /** Returns a number value. */
  getNumber(key: string): number {
    const v = this.get(key)
    if (typeof v === 'number') return v
    if (typeof v === 'string') {
      const n = Number(v)
      return isNaN(n) ? 0 : n
    }
    return 0
  }

  /** Returns an int value. */
  getInt(key: string): number {
    return Math.floor(this.getNumber(key))
  }

  /** Returns a float value. */
  getFloat(key: string): number {
    return this.getNumber(key)
  }

  /** Returns a DateTime value. */
  getDateTime(key: string): DateTime {
    return DateTime.ParseDateTime(this.get(key))
  }

  /** Returns a string array. */
  getStringSlice(key: string): string[] {
    const v = this.get(key)
    if (Array.isArray(v)) return v.map(String)
    if (typeof v === 'string') {
      try {
        const parsed = JSON.parse(v)
        if (Array.isArray(parsed)) return parsed.map(String)
      } catch {
        // not JSON
      }
      return v ? [v] : []
    }
    return []
  }

  // -----------------------------------------------------------------------
  // Expand
  // -----------------------------------------------------------------------

  /**
   * Returns the expand data (shallow copy).
   */
  expandData(): Record<string, unknown> {
    if (!this.expandStore) return {}
    const entries: Record<string, unknown> = {}
    for (const [k, v] of this.expandStore.getAll()) {
      entries[k] = v
    }
    return entries
  }

  /**
   * Replaces the expand data.
   */
  setExpand(expand: Record<string, unknown>): void {
    if (!this.expandStore) {
      this.expandStore = new Store()
    }
    this.expandStore.reset()
    for (const [key, value] of Object.entries(expand)) {
      this.expandStore.set(key, value)
    }
  }

  /**
   * Returns a single expanded relation record.
   */
  expandedOne(relField: string): Record | null {
    if (!this.expandStore) return null
    const rel = this.expandStore.get(relField)
    if (rel instanceof Record) return rel
    if (Array.isArray(rel) && rel.length > 0 && rel[0] instanceof Record) {
      return rel[0]
    }
    return null
  }

  /**
   * Returns all expanded relation records for a field.
   */
  expandedAll(relField: string): Record[] | null {
    if (!this.expandStore) return null
    const rel = this.expandStore.get(relField)
    if (rel instanceof Record) return [rel]
    if (Array.isArray(rel)) return rel.filter((r): r is Record => r instanceof Record)
    return null
  }

  // -----------------------------------------------------------------------
  // Original / Fresh / Clone
  // -----------------------------------------------------------------------

  /**
   * Returns a shallow copy with the ORIGINAL db data state.
   */
  original(): Record {
    const r = new Record(this.collection)
    for (const [key, value] of this.originalData) {
      r.originalData.set(key, value)
    }
    const origId = this.originalData.get(FieldNameId)
    if (origId != null) {
      r.id = String(origId)
    }
    return r
  }

  /**
   * Returns a shallow copy with the LATEST data state.
   */
  fresh(): Record {
    const r = this.original()
    for (const field of this.collection.fields) {
      r.setRaw(field.name, this.getRaw(field.name))
    }
    return r
  }

  /**
   * Returns a full shallow copy including expand and flags.
   */
  clone(): Record {
    const r = this.original()
    r.id = this.id
    r.exportCustomData = this.exportCustomData
    r.ignoreEmailVisibility = this.ignoreEmailVisibility
    r.ignoreUnchangedFields = this.ignoreUnchangedFields

    if (this.customVisibilityStore) {
      for (const [k, v] of this.customVisibilityStore.getAll()) {
        r.customVisibilityStore.set(k, v)
      }
    }

    for (const [k, v] of this.dataStore.getAll()) {
      r.setRaw(k, v)
    }

    if (this.expandStore) {
      const expandEntries: Record<string, unknown> = {}
      for (const [k, v] of this.expandStore.getAll()) {
        expandEntries[k] = v
      }
      r.setExpand(expandEntries)
    }

    return r
  }

  // -----------------------------------------------------------------------
  // Fields data
  // -----------------------------------------------------------------------

  /**
   * Returns a shallow copy ONLY of the collection's fields data.
   */
  fieldsData(): Map<string, unknown> {
    const result = new Map<string, unknown>()
    for (const field of this.collection.fields) {
      result.set(field.name, this.get(field.name))
    }
    return result
  }

  /**
   * Returns ONLY custom (non-collection, non-system) field data.
   */
  customData(): Record<string, unknown> {
    const knownFields = new Set<string>()
    for (const f of this.collection.fields) {
      knownFields.add(f.name)
    }

    const result: Record<string, unknown> = {}
    for (const [k, v] of this.dataStore.getAll()) {
      if (!knownFields.has(k) && !k.startsWith(InternalCustomFieldKeyPrefix)) {
        result[k] = v
      }
    }
    return result
  }

  // -----------------------------------------------------------------------
  // Visibility (Hide / Unhide)
  // -----------------------------------------------------------------------

  /**
   * Hides the specified fields from public serialization.
   */
  hide(...fieldNames: string[]): this {
    for (const name of fieldNames) {
      this.customVisibilityStore.set(name, false)
    }
    return this
  }

  /**
   * Forces unhiding of specified fields.
   */
  unhide(...fieldNames: string[]): this {
    for (const name of fieldNames) {
      this.customVisibilityStore.set(name, true)
    }
    return this
  }

  // -----------------------------------------------------------------------
  // Public export (safe serialization)
  // -----------------------------------------------------------------------

  /**
   * Exports only the fields that are safe to be public.
   *
   * Equivalent to Go's `Record.PublicExport()`.
   */
  publicExport(): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    const customVisibility = this.customVisibilityStore.getAll()

    // Export schema fields
    for (const field of this.collection.fields) {
      const hasCustomVisibility = customVisibility.has(field.name)
      const isVisible = hasCustomVisibility
        ? customVisibility.get(field.name)!
        : !field.hidden

      if (!isVisible) continue
      result[field.name] = this.get(field.name)
    }

    // Export custom fields
    if (this.exportCustomData) {
      for (const [k, v] of Object.entries(this.customData())) {
        if (!customVisibility.has(k) || customVisibility.get(k)) {
          result[k] = v
        }
      }
    }

    // For auth records, always hide password and tokenKey
    if (this.collection.isAuth()) {
      delete result[FieldNamePassword]
      delete result[FieldNameTokenKey]

      if (!this.ignoreEmailVisibility && !this.getBool(FieldNameEmailVisibility)) {
        delete result[FieldNameEmail]
      }
    }

    // Add helper collection reference fields
    result[FieldNameCollectionId] = this.collection.id
    result[FieldNameCollectionName] = this.collection.name

    // Add expand (if non-null)
    if (this.expandStore && this.expandStore.length > 0) {
      const expandEntries: Record<string, unknown> = {}
      for (const [k, v] of this.expandStore.getAll()) {
        expandEntries[k] = v
      }
      result[FieldNameExpand] = expandEntries
    }

    return result
  }

  // -----------------------------------------------------------------------
  // JSON serialization
  // -----------------------------------------------------------------------

  /**
   * JSON serialization — uses PublicExport().
   */
  toJSON(): Record<string, unknown> {
    return this.publicExport()
  }

  /**
   * Loads the record from a JSON object.
   */
  loadFromJSON(data: Record<string, unknown>): void {
    this.load(data)
  }

  // -----------------------------------------------------------------------
  // DB export
  // -----------------------------------------------------------------------

  /**
   * Prepares the data for database persistence.
   */
  dbExport(): Record<string, unknown> {
    const result: Record<string, unknown> = {}

    for (const field of this.collection.fields) {
      result[field.name] = this.getRaw(field.name)
    }

    // Remove unchanged fields (optimization for updates)
    if (!this.isNew() && this.ignoreUnchangedFields) {
      const oldResult = this.original().dbExport()
      for (const [oldK, oldV] of Object.entries(oldResult)) {
        if (oldK === FieldNameId) continue
        const newV = result[oldK]
        if (newV === oldV || JSON.stringify(newV) === JSON.stringify(oldV)) {
          delete result[oldK]
        }
      }
    }

    return result
  }

  /**
   * Finds a file-type field by filename.
   */
  findFileFieldByFile(_filename: string): Field | null {
    // Scans collection fields for a file type field containing the filename
    // This is a stub — the actual FileField type needs to be registered
    for (const field of this.collection.fields) {
      if (field.type === 'file') {
        const filenames = this.getStringSlice(field.name)
        if (filenames.includes(_filename)) {
          return field
        }
      }
    }
    return null
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Returns a default value for the given field.
   */
  private defaultValueForField(_field: Field): unknown {
    // Most fields default to null/empty; specific type defaults can be
    // handled by field implementations
    return null
  }

  /**
   * Normalizes a value according to the field definition.
   */
  private normalizeValue(_field: Field, value: unknown): unknown {
    // Basic normalization — field-specific normalization should be
    // implemented by field types
    return value
  }
}

// ---------------------------------------------------------------------------
// Export field name constants from field.ts for convenience
// ---------------------------------------------------------------------------
export {
  FieldNameId,
  FieldNameCollectionId,
  FieldNameCollectionName,
  FieldNameExpand,
  FieldNamePassword,
  FieldNameTokenKey,
  FieldNameEmail,
  FieldNameEmailVisibility,
  FieldNameVerified,
}
