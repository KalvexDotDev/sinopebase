/**
 * Base collection options — currently empty, reserved for future use.
 *
 * Port of PocketBase's core/collection_model_base_options.go (Go -> TypeScript).
 * Layer 2 — imports from ~/core/field.
 */

// ---------------------------------------------------------------------------
// CollectionBaseOptions
// ---------------------------------------------------------------------------

/**
 * Options for "base" type collections.
 *
 * In PocketBase this struct is empty — it exists as a placeholder for
 * future configuration and to satisfy the `optionsValidator` interface.
 */
export class CollectionBaseOptions {
  /**
   * Validates the options configuration.
   *
   * Currently a no-op since base collections have no configurable options.
   *
   * @returns An array of error messages (empty if valid).
   */
  validate(): string[] {
    return []
  }

  /**
   * Returns a plain JSON-compatible representation of the options.
   */
  toJSON(): Record<string, unknown> {
    return {}
  }

  /**
   * Populates the options from a JSON-compatible object.
   */
  static fromJSON(_data: Record<string, unknown>): CollectionBaseOptions {
    return new CollectionBaseOptions()
  }
}
