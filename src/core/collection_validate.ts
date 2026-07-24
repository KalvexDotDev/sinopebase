/**
 * Collection validation — validate rules, fields, indexes, and options.
 *
 * Port of PocketBase's core/collection_validate.go (Go -> TypeScript).
 * Layer 2 — imports from ~/core/* and ~/tools/*.
 */

import type { IDatabase } from '~/core/db-interface.ts'
import {
  Collection,
  CollectionTypeBase,
  CollectionTypeAuth,
  CollectionTypeView,
  type CollectionType,
} from '~/core/collection_model.ts'
import {
  FieldNameId,
  FieldNameEmail,
  FieldNamePassword,
  FieldNameTokenKey,
  FieldNameEmailVisibility,
  FieldNameVerified,
} from '~/core/field.ts'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Regex for valid collection names. */
const CollectionNameRegex = /^[a-zA-Z][a-zA-Z0-9_]*$/

/** Default id regex pattern (matches "r" + 14 hex chars, or similar). */
const DefaultIdRegex = /^[a-zA-Z0-9]+$/

/** Reserved auth field names that cannot be used as collection field names. */
const ReservedAuthKeys = new Set([
  'passwordConfirm',
  'oldPassword',
])

/** Valid collection types. */
const ValidCollectionTypes = new Set<CollectionType>([
  CollectionTypeBase,
  CollectionTypeAuth,
  CollectionTypeView,
])

// ---------------------------------------------------------------------------
// CollectionValidator
// ---------------------------------------------------------------------------

/**
 * Validator for collection schema definitions.
 *
 * Equivalent to PocketBase's `collectionValidator`.
 */
export class CollectionValidator {
  private original: Collection | null
  private newCollection: Collection

  constructor(
    newCollection: Collection,
    original: Collection | null,
    _db?: IDatabase,
  ) {
    this.newCollection = newCollection
    this.original = original
  }

  /**
   * Runs the full validation pipeline.
   *
   * @returns An array of error messages (empty if valid).
   */
  async validate(): Promise<string[]> {
    const errors: string[] = []

    // 1. Id validation
    errors.push(...this.checkId())

    // 2. System flag check
    errors.push(...this.checkSystemFlag())

    // 3. Type validation
    errors.push(...this.checkType())

    // 4. Name validation
    errors.push(...this.checkName())

    // 5. Field validations
    errors.push(...this.checkMinFields())
    errors.push(...this.checkFieldDuplicates())
    errors.push(...this.checkFieldValidators())
    errors.push(...this.checkReservedAuthKeys())

    // 6. Rule validations
    errors.push(...this.checkRules())

    // 7. Index validations
    errors.push(...this.checkIndexes())

    // 8. Options validation
    errors.push(...this.validateOptions())

    return errors
  }

  // -----------------------------------------------------------------------
  // ID checks
  // -----------------------------------------------------------------------

  private checkId(): string[] {
    const errors: string[] = []

    // For new collections, validate the id format
    if (!this.original) {
      if (!this.newCollection.id) {
        // Auto-generate id later
      } else if (!DefaultIdRegex.test(this.newCollection.id)) {
        errors.push('id: invalid format')
      }
    }

    return errors
  }

  // -----------------------------------------------------------------------
  // System flag checks
  // -----------------------------------------------------------------------

  private checkSystemFlag(): string[] {
    const errors: string[] = []

    if (!this.original) return errors

    if (this.original.system !== this.newCollection.system) {
      errors.push('system: system flag cannot be changed')
    }

    return errors
  }

  // -----------------------------------------------------------------------
  // Type checks
  // -----------------------------------------------------------------------

  private checkType(): string[] {
    const errors: string[] = []

    if (!ValidCollectionTypes.has(this.newCollection.type)) {
      errors.push(`type: must be one of: ${[...ValidCollectionTypes].join(', ')}`)
    }

    // Block type changes
    if (this.original && this.original.type !== this.newCollection.type) {
      errors.push('type: collection type cannot be changed')
    }

    return errors
  }

  // -----------------------------------------------------------------------
  // Name checks
  // -----------------------------------------------------------------------

  private checkName(): string[] {
    const errors: string[] = []

    if (!this.newCollection.name) {
      errors.push('name: is required')
      return errors
    }

    if (this.newCollection.name.length < 1 || this.newCollection.name.length > 255) {
      errors.push('name: must be between 1 and 255 characters')
    }

    if (!CollectionNameRegex.test(this.newCollection.name)) {
      errors.push('name: must start with a letter and contain only letters, digits, and underscores')
    }

    // Check if name is a reserved SQL keyword
    const reservedNames = new Set([
      'id', 'created', 'updated', '_collections', '_params', '_externalauths',
    ])
    if (reservedNames.has(this.newCollection.name.toLowerCase())) {
      errors.push(`name: "${this.newCollection.name}" is a reserved name`)
    }

    return errors
  }

  // -----------------------------------------------------------------------
  // Field checks
  // -----------------------------------------------------------------------

  private checkMinFields(): string[] {
    const errors: string[] = []

    // All collections need at least the "id" field
    const hasId = this.newCollection.fields.getByName(FieldNameId)
    if (!hasId) {
      errors.push('fields: the "id" field is required')
    }

    // Auth collections require specific system fields
    if (this.newCollection.isAuth()) {
      const requiredFields = [
        { name: FieldNamePassword, label: 'password' },
        { name: FieldNameTokenKey, label: 'tokenKey' },
        { name: FieldNameEmail, label: 'email' },
        { name: FieldNameEmailVisibility, label: 'emailVisibility' },
        { name: FieldNameVerified, label: 'verified' },
      ]

      for (const rf of requiredFields) {
        const field = this.newCollection.fields.getByName(rf.name)
        if (!field) {
          errors.push(`fields: auth collection requires a "${rf.label}" field`)
        } else if (!field.system) {
          errors.push(`fields: "${rf.label}" must be a system field`)
        }
      }
    }

    return errors
  }

  private checkFieldDuplicates(): string[] {
    const errors: string[] = []

    // Check for duplicate field ids
    const idMap = new Map<string, number>()
    for (const field of this.newCollection.fields) {
      const count = (idMap.get(field.id) ?? 0) + 1
      idMap.set(field.id, count)
    }
    for (const [id, count] of idMap) {
      if (count > 1 && id) {
        errors.push(`fields: duplicate field id "${id}"`)
      }
    }

    // Check for duplicate field names (case-insensitive)
    const nameMap = new Map<string, number>()
    for (const field of this.newCollection.fields) {
      const lowerName = field.name.toLowerCase()
      const count = (nameMap.get(lowerName) ?? 0) + 1
      nameMap.set(lowerName, count)
    }
    for (const [name, count] of nameMap) {
      if (count > 1) {
        errors.push(`fields: duplicate field name "${name}"`)
      }
    }

    return errors
  }

  private checkFieldValidators(): string[] {
    const errors: string[] = []

    for (const field of this.newCollection.fields) {
      // Check for type change (block changing existing field types)
      if (this.original) {
        const oldField = this.original.fields.getById(field.id)
        if (oldField && oldField.type !== field.type) {
          errors.push(`fields: "${field.name}" type change is not allowed`)
        }
      }
    }

    return errors
  }

  private checkReservedAuthKeys(): string[] {
    const errors: string[] = []

    if (!this.newCollection.isAuth()) return errors

    for (const field of this.newCollection.fields) {
      if (ReservedAuthKeys.has(field.name)) {
        errors.push(`fields: "${field.name}" is a reserved key name for auth collections`)
      }
    }

    return errors
  }

  // -----------------------------------------------------------------------
  // Rule checks
  // -----------------------------------------------------------------------

  private checkRules(): string[] {
    const errors: string[] = []

    // View collections force create/update/delete rules to null
    if (this.newCollection.isView()) {
      if (this.newCollection.createRule !== null) {
        errors.push('createRule: view collections cannot have create rules')
      }
      if (this.newCollection.updateRule !== null) {
        errors.push('updateRule: view collections cannot have update rules')
      }
      if (this.newCollection.deleteRule !== null) {
        errors.push('deleteRule: view collections cannot have delete rules')
      }
    }

    // For system collections, block rule changes
    if (this.newCollection.system && this.original) {
      const ruleFields = ['listRule', 'viewRule', 'createRule', 'updateRule', 'deleteRule'] as const
      for (const ruleField of ruleFields) {
        if (this.original[ruleField] !== this.newCollection[ruleField]) {
          errors.push(`${ruleField}: cannot change rules on system collections`)
        }
      }
    }

    return errors
  }

  // -----------------------------------------------------------------------
  // Index checks
  // -----------------------------------------------------------------------

  private checkIndexes(): string[] {
    const errors: string[] = []

    // Parse and validate each index expression
    for (let i = 0; i < this.newCollection.indexes.length; i++) {
      const idx = this.newCollection.indexes[i]!
      if (!idx || idx.trim() === '') {
        errors.push(`indexes[${i}]: empty index expression`)
        continue
      }

      // Basic CREATE INDEX validation
      const upper = idx.toUpperCase().trim()
      if (!upper.startsWith('CREATE')) {
        errors.push(`indexes[${i}]: must start with CREATE`)
      }
    }

    // Check for duplicate index definitions
    const indexedDefs = new Set<string>()
    for (const idx of this.newCollection.indexes) {
      if (indexedDefs.has(idx)) {
        errors.push(`indexes: duplicate index definition "${idx}"`)
      }
      indexedDefs.add(idx)
    }

    return errors
  }

  // -----------------------------------------------------------------------
  // Options validation
  // -----------------------------------------------------------------------

  private validateOptions(): string[] {
    const errors: string[] = []

    if (this.newCollection.isAuth() && this.newCollection.authOptions) {
      errors.push(
        ...this.newCollection.authOptions.validate().map((e) => `options.${e}`),
      )
    }

    return errors
  }
}

// ---------------------------------------------------------------------------
// Standalone validation function
// ---------------------------------------------------------------------------

/**
 * Validates a collection definition.
 *
 * @returns A map of field -> error messages (empty if valid).
 */
export async function validateCollection(
  collection: Collection,
  original: Collection | null,
  db: IDatabase,
): Promise<Record<string, string[]>> {
  const validator = new CollectionValidator(collection, original, db)
  const allErrors = await validator.validate()

  // Group errors by field
  const grouped: Record<string, string[]> = {}
  for (const err of allErrors) {
    const colonIdx = err.indexOf(':')
    const key = colonIdx >= 0 ? err.substring(0, colonIdx).trim() : '_general'
    const msg = colonIdx >= 0 ? err.substring(colonIdx + 1).trim() : err

    if (!grouped[key]) grouped[key] = []
    grouped[key]!.push(msg)
  }

  return grouped
}

/**
 * Checks that the collection name is a valid table name (no SQL injection).
 */
export function isValidCollectionName(name: string): boolean {
  return CollectionNameRegex.test(name)
}
