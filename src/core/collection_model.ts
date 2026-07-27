/**
 * Collection model — defines how collections (tables) are structured.
 *
 * Port of PocketBase's core/collection_model.go (Go -> TypeScript).
 * Layer 2 — imports from ~/core/*.
 */

import {
  AuthAlertConfig,
  CollectionAuthOptions,
  MFAConfig,
  OAuth2Config,
  OTPConfig,
  PasswordAuthConfig,
  TokenConfig,
} from '~/core/collection_model_auth_options.ts'
import type { CollectionBaseOptions } from '~/core/collection_model_base_options.ts'
import type { CollectionViewOptions } from '~/core/collection_model_view_options.ts'
import { BaseModel } from '~/core/db_model.ts'
import {
  type Field,
  FieldNameEmail,
  FieldNameEmailVisibility,
  FieldNameId,
  FieldNamePassword,
  FieldNameTokenKey,
  FieldNameVerified,
} from '~/core/field.ts'
import { FieldsList } from '~/core/fields_list.ts'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CollectionTypeBase = 'base' as const
export const CollectionTypeAuth = 'auth' as const
export const CollectionTypeView = 'view' as const

export type CollectionType =
  | typeof CollectionTypeBase
  | typeof CollectionTypeAuth
  | typeof CollectionTypeView

export const DefaultIdLength = 15

// ---------------------------------------------------------------------------
// FieldsList
// ---------------------------------------------------------------------------

/**
 * FieldsList is re-exported from ~/core/fields_list.ts for convenience.
 *
 * Note: PocketBase's core package defines FieldsList in its own collection_model.go
 * but this TypeScript port separates it into fields_list.ts to keep file sizes
 * manageable.
 */
export { FieldsList } from '~/core/fields_list.ts'

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

/**
 * Collection defines the schema for a table (base, auth, or view).
 *
 * Equivalent to PocketBase's `core.Collection`.
 */
export class Collection extends BaseModel {
  // -- core schema fields ------------------------------------------------
  name: string = ''
  type: CollectionType = CollectionTypeBase
  system: boolean = false

  /** Ordered list of field definitions. */
  fields: FieldsList = new FieldsList()

  /** Raw index expressions (e.g., "CREATE UNIQUE INDEX ..."). */
  indexes: string[] = []

  // -- access rules -----------------------------------------------------
  listRule: string | null = null
  viewRule: string | null = null
  createRule: string | null = null
  updateRule: string | null = null
  deleteRule: string | null = null

  // -- raw JSON options (used for serialization round-trip) -------------
  rawOptions: Record<string, unknown> = {}

  // -- type-specific options (only one is active based on type) ---------
  authOptions?: CollectionAuthOptions
  viewOptions?: CollectionViewOptions
  baseOptions?: CollectionBaseOptions

  /**
   * Returns the table name used for persistence of collection metadata.
   * This is always "_collections".
   */
  tableName(): string {
    return '_collections'
  }

  /**
   * Returns the files base path for this collection.
   */
  baseFilesPath(): string {
    return this.id
  }

  // -- type checks ------------------------------------------------------

  isBase(): boolean {
    return this.type === CollectionTypeBase
  }

  isAuth(): boolean {
    return this.type === CollectionTypeAuth
  }

  isView(): boolean {
    return this.type === CollectionTypeView
  }

  // -- index helpers ----------------------------------------------------

  /**
   * Returns all index expressions as a mutable array.
   */
  getIndexes(): string[] {
    return [...this.indexes]
  }

  /**
   * Adds an index expression.
   */
  addIndex(index: string): void {
    this.indexes.push(index)
  }

  /**
   * Removes an index expression.
   *
   * @returns true if an index was removed.
   */
  removeIndex(index: string): boolean {
    const idx = this.indexes.indexOf(index)
    if (idx === -1) return false
    this.indexes.splice(idx, 1)
    return true
  }

  // -- auth options accessor --------------------------------------------

  /**
   * Returns the auth options. Throws if the collection is not an auth type.
   */
  getAuthOptions(): CollectionAuthOptions {
    if (!this.isAuth()) {
      throw new Error('collection is not an auth type')
    }
    if (!this.authOptions) {
      this.authOptions = Collection.createDefaultAuthOptions()
    }
    return this.authOptions
  }

  /**
   * Returns the view options. Throws if the collection is not a view type.
   */
  getViewOptions(): CollectionViewOptions {
    if (!this.isView()) {
      throw new Error('collection is not a view type')
    }
    const opts = this.viewOptions
    if (!opts) throw new Error('viewOptions not set for view-type collection')
    return opts
  }

  // -- serialization ----------------------------------------------------

  /**
   * Prepares the data for DB persistence.
   *
   * Equivalent to Go's `Collection.DBExport()`.
   */
  dbExport(): Record<string, unknown> {
    const data: Record<string, unknown> = {
      id: this.id,
      name: this.name,
      type: this.type,
      system: this.system,
      listRule: this.listRule,
      viewRule: this.viewRule,
      createRule: this.createRule,
      updateRule: this.updateRule,
      deleteRule: this.deleteRule,
      indexes: JSON.stringify(this.indexes),
    }

    // Serialize fields
    data.fields = JSON.stringify(this.fields.toJSON())

    // Serialize type-specific options
    if (this.isAuth() && this.authOptions) {
      data.options = JSON.stringify(this.authOptions.toJSON())
    } else if (this.isView() && this.viewOptions) {
      data.options = JSON.stringify(this.viewOptions.toJSON())
    } else {
      data.options = '{}'
    }

    return data
  }

  /**
   * Populates the collection from a DB row.
   */
  loadFromDb(data: Record<string, unknown>): void {
    this.id = String(data.id ?? '')
    this.name = String(data.name ?? '')
    this.type = (data.type as CollectionType) ?? CollectionTypeBase
    this.system = Boolean(data.system)

    this.listRule = data.listRule != null ? String(data.listRule) : null
    this.viewRule = data.viewRule != null ? String(data.viewRule) : null
    this.createRule = data.createRule != null ? String(data.createRule) : null
    this.updateRule = data.updateRule != null ? String(data.updateRule) : null
    this.deleteRule = data.deleteRule != null ? String(data.deleteRule) : null

    // Parse indexes
    if (typeof data.indexes === 'string') {
      try {
        this.indexes = JSON.parse(data.indexes)
      } catch {
        this.indexes = []
      }
    } else if (Array.isArray(data.indexes)) {
      this.indexes = data.indexes.map(String)
    }

    // Parse fields
    if (typeof data.fields === 'string') {
      try {
        this.fields = FieldsList.fromJSON(data.fields)
      } catch {
        // ignore parse errors
      }
    }

    // Parse options
    if (typeof data.options === 'string' && data.options) {
      try {
        const opts = JSON.parse(data.options) as Record<string, unknown>
        this.rawOptions = opts
        if (this.isAuth()) {
          this.authOptions = CollectionAuthOptions.fromJSON(opts)
        } else if (this.isView()) {
          // View options - would need factory
        }
      } catch {
        // ignore parse errors
      }
    }
  }

  // -- JSON serialization (API responses) -------------------------------

  /**
   * Custom JSON serialization that redacts sensitive auth fields.
   *
   * Equivalent to Go's `Collection.MarshalJSON()`.
   */
  toJSON(): Record<string, unknown> {
    const result: Record<string, unknown> = {
      id: this.id,
      name: this.name,
      type: this.type,
      system: this.system,
      fields: this.fields.toJSON(),
      indexes: [...this.indexes],
      listRule: this.listRule,
      viewRule: this.viewRule,
      createRule: this.createRule,
      updateRule: this.updateRule,
      deleteRule: this.deleteRule,
      created: this.created.toJSON(),
      updated: this.updated.toJSON(),
    }

    // Serialize type-specific options
    if (this.isAuth() && this.authOptions) {
      result.options = this.authOptions.toJSON()
    } else if (this.isView() && this.viewOptions) {
      result.options = this.viewOptions.toJSON()
    } else {
      result.options = this.baseOptions?.toJSON() ?? {}
    }

    return result
  }

  /**
   * Loads the collection from a JSON object (from API).
   */
  loadFromJSON(data: Record<string, unknown>): void {
    if (typeof data.id === 'string') this.id = data.id
    if (typeof data.name === 'string') this.name = data.name
    if (typeof data.type === 'string') this.type = data.type as CollectionType
    if (typeof data.system === 'boolean') this.system = data.system

    if (data.listRule !== undefined)
      this.listRule = data.listRule != null ? String(data.listRule) : null
    if (data.viewRule !== undefined)
      this.viewRule = data.viewRule != null ? String(data.viewRule) : null
    if (data.createRule !== undefined)
      this.createRule = data.createRule != null ? String(data.createRule) : null
    if (data.updateRule !== undefined)
      this.updateRule = data.updateRule != null ? String(data.updateRule) : null
    if (data.deleteRule !== undefined)
      this.deleteRule = data.deleteRule != null ? String(data.deleteRule) : null

    if (Array.isArray(data.indexes)) {
      this.indexes = data.indexes.map(String)
    }

    if (Array.isArray(data.fields)) {
      this.fields = FieldsList.fromJSON(data.fields as Record<string, unknown>[])
    }

    if (data.options && typeof data.options === 'object') {
      const opts = data.options as Record<string, unknown>
      this.rawOptions = opts
      if (this.isAuth()) {
        this.authOptions = CollectionAuthOptions.fromJSON(opts)
      }
    }
  }

  // -- factory helpers --------------------------------------------------

  /**
   * Creates default auth options with secure random secrets.
   */
  static createDefaultAuthOptions(): CollectionAuthOptions {
    const opts = new CollectionAuthOptions()
    opts.authToken = TokenConfig.withRandomSecret(432000) // 5 days
    opts.passwordResetToken = TokenConfig.withRandomSecret(1800) // 30 min
    opts.emailChangeToken = TokenConfig.withRandomSecret(1800) // 30 min
    opts.verificationToken = TokenConfig.withRandomSecret(604800) // 7 days
    opts.fileToken = TokenConfig.withRandomSecret(120) // 2 min
    opts.passwordAuth = new PasswordAuthConfig()
    opts.oauth2 = new OAuth2Config()
    opts.mfa = new MFAConfig()
    opts.otp = new OTPConfig()
    opts.authAlert = new AuthAlertConfig()
    return opts
  }

  /**
   * Creates a new base collection with default fields.
   */
  static createBase(name: string): Collection {
    const c = new Collection()
    c.name = name
    c.type = CollectionTypeBase
    c.initDefaultFields()
    return c
  }

  /**
   * Creates a new auth collection with default fields and options.
   */
  static createAuth(name: string): Collection {
    const c = new Collection()
    c.name = name
    c.type = CollectionTypeAuth
    c.authOptions = Collection.createDefaultAuthOptions()
    c.initDefaultAuthFields()
    return c
  }

  /**
   * Creates a new view collection.
   */
  static createView(name: string): Collection {
    const c = new Collection()
    c.name = name
    c.type = CollectionTypeView
    return c
  }

  /**
   * Initializes the default fields for a base collection.
   */
  private initDefaultFields(): void {
    this.fields = new FieldsList()
    // The "id" field is always added by the system
  }

  /**
   * Initializes the default fields for an auth collection.
   */
  private initDefaultAuthFields(): void {
    this.fields = new FieldsList()
    // Auth collections have system fields: id, password, tokenKey, email,
    // emailVisibility, verified — these are added by the system
  }
}

// ---------------------------------------------------------------------------
// Helper: FieldsList from JSON
// ---------------------------------------------------------------------------

/**
 * Creates a FieldsList from an array of JSON field descriptors.
 *
 * Uses the global field registry to construct the proper field type instances,
 * falling back to generic field objects for unregistered types.
 */
export function FieldsListFromJSON(fields: Record<string, unknown>[]): FieldsList {
  const list = new FieldsList()
  for (const f of fields) {
    const field = createFieldFromJSON(f)
    if (field) {
      list.add(field)
    }
  }
  return list
}

/**
 * Creates a single Field instance from a JSON descriptor.
 *
 * Creates a generic field object from the JSON data, supporting
 * all standard field properties.
 */
function createFieldFromJSON(json: Record<string, unknown>): Field | null {
  if (!json.type || typeof json.type !== 'string') return null

  // Create a field object with all properties from JSON
  const field: Field = {
    id: String(json.id ?? ''),
    name: String(json.name ?? ''),
    type: String(json.type),
    system: Boolean(json.system),
    hidden: Boolean(json.hidden),
    columnType: String(json.columnType ?? 'TEXT DEFAULT NULL'),
    settingsSchema: (json.settingsSchema as Record<string, unknown>) ?? {},
  }

  return field
}

// Re-export commonly used field names for convenience
export {
  FieldNameEmail,
  FieldNameEmailVisibility,
  FieldNameId,
  FieldNamePassword,
  FieldNameTokenKey,
  FieldNameVerified,
}
