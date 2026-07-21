/**
 * FieldsList — an ordered map of fields with Add, Get, Remove semantics.
 *
 * Port of PocketBase's core/fields_list.go (Go -> TypeScript).
 * Layer 2 — imports from ~/tools/*.
 */

import type { Field } from '~/core/field.ts'
import { Fields } from '~/core/field.ts'

// ---------------------------------------------------------------------------
// CRC32 checksum helper (simple string hash for generating field IDs)
// ---------------------------------------------------------------------------

/**
 * Computes a simple CRC32-like checksum for a string.
 * This mirrors PocketBase's crc32Checksum function used for field ID generation.
 */
function crc32Checksum(input: string): string {
  let crc = 0xffffffff
  for (let i = 0; i < input.length; i++) {
    const byte = input.charCodeAt(i) & 0xff
    crc ^= byte
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xedb88320
      } else {
        crc = crc >>> 1
      }
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

// ---------------------------------------------------------------------------
// FieldsList
// ---------------------------------------------------------------------------

/**
 * FieldsList defines an ordered collection of fields.
 *
 * Provides methods for adding, getting, and removing fields by id or name.
 * The Add() method attempts to replace existing fields by id or by name,
 * and auto-generates IDs for new fields without one.
 */
export class FieldsList {
  private items: Field[] = []

  /**
   * Creates a new FieldsList, optionally initialised with the provided fields.
   */
  constructor(fields?: Field[]) {
    if (fields) {
      for (const f of fields) {
        this.insertAt(-1, f)
      }
    }
  }

  /**
   * Returns the number of fields in the list.
   */
  get length(): number {
    return this.items.length
  }

  /**
   * Creates a deep clone of the current fields list.
   * Each field is reconstructed via its factory to ensure independent instances.
   */
  clone(): FieldsList {
    const cloned = new FieldsList()
    for (const field of this.items) {
      const factory = Fields.get(field.type)
      if (factory) {
        const copy = factory()
        // Copy all enumerable properties
        Object.assign(copy, JSON.parse(JSON.stringify(field)))
        cloned.items.push(copy)
      }
    }
    return cloned
  }

  /**
   * Makes FieldsList iterable (for...of support).
   */
  [Symbol.iterator](): IterableIterator<Field> {
    return this.items[Symbol.iterator]()
  }

  /**
   * Returns an array of all field names.
   */
  fieldNames(): string[] {
    return this.items.map((f) => f.name)
  }

  /**
   * Returns a map of field name -> field for all registered fields.
   */
  asMap(): Record<string, Field> {
    const result: Record<string, Field> = {}
    for (const field of this.items) {
      result[field.name] = field
    }
    return result
  }

  /**
   * Returns a single field by its id.
   */
  getById(fieldId: string): Field | undefined {
    return this.items.find((f) => f.id === fieldId)
  }

  /**
   * Returns a single field by its name.
   */
  getByName(fieldName: string): Field | undefined {
    return this.items.find((f) => f.name === fieldName)
  }

  /**
   * Returns the field at the given index.
   */
  getAt(index: number): Field | undefined {
    return this.items[index]
  }

  /**
   * Removes a single field by its id (no-op if not found).
   */
  removeById(fieldId: string): void {
    const index = this.items.findIndex((f) => f.id === fieldId)
    if (index !== -1) {
      this.items.splice(index, 1)
    }
  }

  /**
   * Removes a single field by its name (no-op if not found).
   */
  removeByName(fieldName: string): void {
    const index = this.items.findIndex((f) => f.name === fieldName)
    if (index !== -1) {
      this.items.splice(index, 1)
    }
  }

  /**
   * Returns all fields as an array.
   */
  all(): Field[] {
    return [...this.items]
  }

  /**
   * Adds one or more fields to the list.
   *
   * This method attempts to REPLACE existing fields by their id, or by name
   * if the new field doesn't have an explicit id. If no match is found,
   * the field is appended to the end of the list.
   *
   * If any of the new fields don't have an explicit id, one is auto-generated.
   */
  add(...fields: Field[]): void {
    for (const f of fields) {
      this.insertAt(-1, f)
    }
  }

  /**
   * Same as add() but inserts/moves fields at the specific position.
   *
   * If pos < 0, behaves the same as add().
   * If pos > total items, fields are inserted at the end.
   */
  addAt(pos: number, ...fields: Field[]): void {
    const total = this.items.length
    for (let i = 0; i < fields.length; i++) {
      const insertPos = pos < 0 ? -1 : pos > total ? total + i : pos + i
      this.insertAt(insertPos, fields[i]!)
    }
  }

  /**
   * Internal add implementation.
   *
   * @param pos - Position to insert at (-1 = append/replace in place)
   * @param newField - The field to add
   */
  private insertAt(pos: number, newField: Field): void {
    let replaceByName = false
    let replaceInPlace = false

    if (pos < 0) {
      replaceInPlace = true
      pos = this.items.length
    } else if (pos > this.items.length) {
      pos = this.items.length
    }

    let newFieldId = newField.id

    // Set default id if missing
    if (!newFieldId) {
      replaceByName = true
      const baseId = `${newField.type}_${crc32Checksum(newField.name)}`
      newFieldId = baseId
      for (let i = 2; i < 1000; i++) {
        if (!this.getById(newFieldId)) {
          break
        }
        newFieldId = `${baseId}${i}`
      }
      newField.id = newFieldId
    }

    // Try to replace existing
    for (let i = 0; i < this.items.length; i++) {
      const field = this.items[i]!
      if (replaceByName) {
        if (newField.name && field.name === newField.name) {
          // Reuse the original id
          newField.id = field.id

          if (replaceInPlace) {
            this.items[i] = newField
            return
          } else {
            // Remove the current field and insert it later at the specific position
            this.items.splice(i, 1)
            if (pos > this.items.length) {
              pos = this.items.length
            }
            break
          }
        }
      } else {
        if (field.id === newFieldId) {
          if (replaceInPlace) {
            this.items[i] = newField
            return
          } else {
            // Remove the current field and insert it later at the specific position
            this.items.splice(i, 1)
            if (pos > this.items.length) {
              pos = this.items.length
            }
            break
          }
        }
      }
    }

    // Insert the new field at the position
    this.items.splice(pos, 0, newField)
  }

  /**
   * Serializes the FieldsList to JSON.
   */
  toJSON(): Record<string, unknown>[] {
    return this.items.map((f) => ({
      ...JSON.parse(JSON.stringify(f)),
      type: f.type,
      id: f.id,
      name: f.name,
      system: f.system,
      hidden: f.hidden,
    }))
  }

  /**
   * Creates a FieldsList from a JSON array of field definitions.
   *
   * Each element must have a "type" field that maps to a registered field factory.
   *
   * @param json - The JSON string or parsed array of field objects.
   */
  static fromJSON(json: string | Record<string, unknown>[]): FieldsList {
    const items = typeof json === 'string' ? JSON.parse(json) : json
    const list = new FieldsList()

    if (!Array.isArray(items)) return list

    for (const item of items) {
      const type = item.type as string
      const factory = Fields.get(type)
      if (factory) {
        const field = factory()
        // Apply properties from JSON, skipping the "type" key
        // and read-only (getter-only) properties
        for (const key of Object.keys(item)) {
          if (key === 'type') continue
          if (!(key in field)) continue

          // Skip getter-only properties (no setter)
          const desc = Object.getOwnPropertyDescriptor(
            Object.getPrototypeOf(field),
            key,
          )
          if (desc && desc.get && !desc.set) continue

          ;(field as Record<string, unknown>)[key] = item[key]
        }
        list.add(field)
      }
    }

    return list
  }

  /**
   * Returns the string representation (JSON) of the list.
   */
  toString(): string {
    return JSON.stringify(this.toJSON())
  }
}
