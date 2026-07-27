/**
 * Field interface — the base contract for all PocketBase collection field types.
 *
 * Port of PocketBase's core/field.go (Go -> TypeScript).
 * Layer 2 — imports from ~/tools/*.
 *
 * Each field type:
 *   - Carries its config/metadata as instance properties
 *   - Exports a ColumnType() describing the SQL column DDL
 *   - Exports a SettingsSchema() returning a TypeBox JSON schema for validation
 */

// ---------------------------------------------------------------------------
// Commonly used field names
// ---------------------------------------------------------------------------

export const FieldNameId = 'id'
export const FieldNameCollectionId = 'collectionId'
export const FieldNameCollectionName = 'collectionName'
export const FieldNameExpand = 'expand'
export const FieldNameEmail = 'email'
export const FieldNameEmailVisibility = 'emailVisibility'
export const FieldNameVerified = 'verified'
export const FieldNameTokenKey = 'tokenKey'
export const FieldNamePassword = 'password'

/**
 * System dynamic field names — special internal fields that are usually readonly.
 */
export const SystemDynamicFieldNames: readonly string[] = [
  FieldNameCollectionId,
  FieldNameCollectionName,
  FieldNameExpand,
] as const

/**
 * Excluded names for field validation (reserved SQL / filter keywords + system names).
 */
export const ExcludedFieldNames: readonly string[] = [
  'null',
  'true',
  'false',
  '_rowid_',
  ...SystemDynamicFieldNames,
] as const

// ---------------------------------------------------------------------------
// Field interface
// ---------------------------------------------------------------------------

/**
 * A FieldFactoryFunc constructs a blank Field instance of a specific type.
 */
export type FieldFactoryFunc = () => Field

/**
 * Field defines the common interface that all collection fields implement.
 *
 * In this TypeScript port, the interface focuses on the config/metadata
 * each field type carries — the column type, default settings, and
 * a JSON schema fragment for validation. Go-style record-level validation
 * methods are omitted since TypeScript has its own type system.
 */
export interface Field {
  /** Unique stable field identifier. */
  id: string

  /** Unique field name within the collection. */
  name: string

  /** System flag — prevents renaming and removal of the field. */
  system: boolean

  /** Hidden flag — hides the field from API responses. */
  hidden: boolean

  /** The field's type identifier (e.g. "text", "number", "bool"). */
  readonly type: string

  /**
   * Returns the SQL column type definition for this field.
   */
  columnType: string

  /**
   * Returns a JSON Schema (TypeBox TSchema-compatible) fragment
   * describing the field value shape for API validation.
   */
  settingsSchema: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Field Factory Registry
// ---------------------------------------------------------------------------

/**
 * Global registry of field factories, keyed by field type name.
 */
export const Fields: Map<string, FieldFactoryFunc> = new Map()

/**
 * Registers a field type with the global factory registry.
 *
 * @param type - The unique field type identifier.
 * @param factory - A factory function creating a default instance of the field.
 */
export function RegisterField(type: string, factory: FieldFactoryFunc): void {
  Fields.set(type, factory)
}

/**
 * Creates a new field instance by its registered type name.
 *
 * @param type - The field type identifier.
 * @returns A new field instance, or undefined if the type is not registered.
 */
export function CreateField(type: string): Field | undefined {
  const factory = Fields.get(type)
  if (!factory) return undefined
  return factory()
}

// ---------------------------------------------------------------------------
// Field name validation
// ---------------------------------------------------------------------------

/**
 * Regex pattern for valid field names.
 * Must match `^\w+$` (alphanumeric + underscore).
 */
export const fieldNameRegex = /^\w+$/

/**
 * Maximum safe JSON integer value (2^53 - 1).
 */
export const maxSafeJSONInt = Number.MAX_SAFE_INTEGER

/**
 * Validates a field name according to PocketBase rules.
 */
export function ValidateFieldName(name: string): string | null {
  if (!name) return 'Field name is required'
  if (name.length > 100) return 'Field name must be at most 100 characters'
  if (!fieldNameRegex.test(name))
    return 'Field name must contain only word characters (letters, digits, underscore)'
  if (ExcludedFieldNames.includes(name.toLowerCase())) return `"${name}" is a reserved name`
  if (name.toLowerCase().includes('_via_')) return 'Field name cannot contain "_via_"'
  return null
}

/**
 * Validates a field ID.
 */
export function ValidateFieldId(id: string): string | null {
  if (!id) return 'Field ID is required'
  if (id.length > 100) return 'Field ID must be at most 100 characters'
  return null
}
