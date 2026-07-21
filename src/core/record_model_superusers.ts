/**
 * Superuser record helpers.
 *
 * Port of PocketBase's core/record_model_superusers.go (Go -> TypeScript).
 * Layer 2 — imports from ~/core/record_model.
 */

import type { Record } from '~/core/record_model.ts'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The name of the superusers collection. */
export const SuperusersCollectionName = '_superusers'

// ---------------------------------------------------------------------------
// Superuser checks
// ---------------------------------------------------------------------------

/**
 * Returns true if the record belongs to the superusers collection.
 *
 * Equivalent to Go's `Record.IsSuperuser()`.
 */
export function isSuperuser(record: Record): boolean {
  return record.collection.name === SuperusersCollectionName
}
