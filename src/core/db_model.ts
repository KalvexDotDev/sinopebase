/**
 * Model interface and BaseModel implementation.
 *
 * Port of PocketBase models/base.go (Go -> TypeScript).
 *
 * Defines the Model interface that all database models must satisfy,
 * and the BaseModel struct that provides common fields (Id, Created, Updated).
 */

import { DateTime } from '~/tools/types/datetime'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default length of generated model IDs (matches PocketBase: 15). */
export const DefaultIdLength = 15

/** Default alphabet for generated model IDs. */
export const DefaultIdAlphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/**
 * ColumnValueMapper defines an interface for custom db model data serialization.
 */
export interface ColumnValueMapper {
  /** Returns the data to be used when persisting the model. */
  columnValueMap(): Record<string, unknown>
}

/**
 * FilesManager defines an interface with common methods that files manager
 * models should implement.
 */
export interface FilesManager {
  /** Returns the storage dir path used by the instance. */
  baseFilesPath(): string
}

/**
 * Model defines an interface with common methods that all db models should have.
 */
export interface Model {
  /** Returns the model's database table name. */
  tableName(): string

  /** Returns whether the model is new (not yet persisted). */
  isNew(): boolean

  /** Marks the model as new (enforces isNew() to be true). */
  markAsNew(): void

  /** Marks the model as not new (enforces isNew() to be false). */
  markAsNotNew(): void

  /** Returns whether the model has a non-zero id. */
  hasId(): boolean

  /** Returns the model id. */
  getId(): string

  /** Sets the model id. */
  setId(id: string): void

  /** Returns the model Created datetime. */
  getCreated(): DateTime

  /** Returns the model Updated datetime. */
  getUpdated(): DateTime

  /** Generates and sets a new random model id. */
  refreshId(): void

  /** Updates the Created field with the current datetime. */
  refreshCreated(): void

  /** Updates the Updated field with the current datetime. */
  refreshUpdated(): void
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

/**
 * Generates a cryptographically random string of the specified length
 * using the default alphabet.
 */
function randomString(length: number): string {
  const chars = DefaultIdAlphabet
  let result = ''
  const array = new Uint8Array(length)
  crypto.getRandomValues(array)
  for (let i = 0; i < length; i++) {
    const r = array[i]
    if (r === undefined) continue
    result += chars[r % chars.length]
  }
  return result
}

// ---------------------------------------------------------------------------
// BaseModel
// ---------------------------------------------------------------------------

/**
 * BaseModel defines common fields and methods used by all other models.
 *
 * Port of PocketBase's models.BaseModel.
 */
export class BaseModel implements Model {
  /** Tracks whether the model is "not new" (inverse of isNew). */
  private isNotNew = false

  /** The model's unique identifier. */
  id = ''

  /** The model's creation timestamp. */
  created: DateTime = new DateTime(null)

  /** The model's last-updated timestamp. */
  updated: DateTime = new DateTime(null)

  // --------------------------------------------------
  // Id
  // --------------------------------------------------

  /** Returns whether the model has a non-zero id. */
  hasId(): boolean {
    return this.getId() !== ''
  }

  /** Returns the model id. */
  getId(): string {
    return this.id
  }

  /** Sets the model id. */
  setId(id: string): void {
    this.id = id
  }

  // --------------------------------------------------
  // New-ness
  // --------------------------------------------------

  /** Marks the model as new (enforces isNew() to be true). */
  markAsNew(): void {
    this.isNotNew = false
  }

  /** Marks the model as not new (enforces isNew() to be false). */
  markAsNotNew(): void {
    this.isNotNew = true
  }

  /**
   * Indicates what type of db query (insert or update)
   * should be used with the model instance.
   */
  isNew(): boolean {
    return !this.isNotNew
  }

  // --------------------------------------------------
  // Timestamps
  // --------------------------------------------------

  /** Returns the model Created datetime. */
  getCreated(): DateTime {
    return this.created
  }

  /** Returns the model Updated datetime. */
  getUpdated(): DateTime {
    return this.updated
  }

  // --------------------------------------------------
  // Refresh methods
  // --------------------------------------------------

  /**
   * Generates and sets a new model id.
   *
   * The generated id is a cryptographically random 15-character string.
   */
  refreshId(): void {
    this.id = randomString(DefaultIdLength)
  }

  /** Updates the Created field with the current datetime. */
  refreshCreated(): void {
    this.created = DateTime.NowDateTime()
  }

  /** Updates the Updated field with the current datetime. */
  refreshUpdated(): void {
    this.updated = DateTime.NowDateTime()
  }

  /**
   * PostScan is called after populating the model from DB row data.
   * It marks the model as "not new".
   */
  postScan(): void {
    this.markAsNotNew()
  }
}
