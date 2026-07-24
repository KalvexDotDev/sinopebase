/**
 * View collection options — configuration for "view" type collections.
 *
 * Port of PocketBase's core/collection_model_view_options.go (Go -> TypeScript).
 * Layer 2 — imports from ~/core/field.
 */

// ---------------------------------------------------------------------------
// CollectionViewOptions
// ---------------------------------------------------------------------------

/**
 * Options for "view" type collections.
 *
 * A view collection is backed by a SQL query (`ViewQuery`).
 * ViewMinId and ViewMaxId are metadata fields tracking the id range
 * of the underlying records.
 */
export class CollectionViewOptions {
  /** The SQL query that defines the view. */
  viewQuery: string = ''

  /** Minimum id in the view result set (metadata / caching). */
  viewMinId: string = ''

  /** Maximum id in the view result set (metadata / caching). */
  viewMaxId: string = ''

  /**
   * Validates the options configuration.
   *
   * @returns An array of error messages (empty if valid).
   */
  validate(): string[] {
    const errors: string[] = []

    if (!this.viewQuery || this.viewQuery.trim() === '') {
      errors.push('viewQuery: is required')
    }

    return errors
  }

  /**
   * Returns a plain JSON-compatible representation of the options.
   */
  toJSON(): Record<string, unknown> {
    return {
      viewQuery: this.viewQuery,
      viewMinId: this.viewMinId,
      viewMaxId: this.viewMaxId,
    }
  }

  /**
   * Populates the options from a JSON-compatible object.
   */
  static fromJSON(data: Record<string, unknown>): CollectionViewOptions {
    const opts = new CollectionViewOptions()
    if (typeof data['viewQuery'] === 'string') opts.viewQuery = data['viewQuery']
    if (typeof data['viewMinId'] === 'string') opts.viewMinId = data['viewMinId']
    if (typeof data['viewMaxId'] === 'string') opts.viewMaxId = data['viewMaxId']
    return opts
  }
}
