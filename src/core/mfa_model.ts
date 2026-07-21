/**
 * MFA model for multi-factor authentication records.
 *
 * Port of PocketBase's models (Go -> TypeScript).
 *
 * MFA represents a multi-factor authentication challenge record.
 */

import { BaseModel } from './db_model'
import { DateTime } from '~/tools/types/datetime'

/**
 * MFA represents a multi-factor authentication record.
 */
export class MFA extends BaseModel {
  /** The auth collection id. */
  collectionId = ''

  /** The auth record id. */
  recordId = ''

  /** The MFA challenge (e.g., TOTP secret, recovery code). */
  challenge = ''

  /** Whether the MFA challenge has been verified. */
  verified = false

  /** The timestamp when this MFA challenge expires. */
  expiresAt: DateTime = new DateTime(null)

  override tableName(): string {
    return '_mfas'
  }
}
