/**
 * OTP model for one-time password records.
 *
 * Port of PocketBase's models (Go -> TypeScript).
 *
 * OTP represents a one-time password challenge used for
 * passwordless authentication or secondary verification.
 */

import { DateTime } from '~/tools/types/datetime'
import { BaseModel } from './db_model'

/**
 * OTP represents a one-time password record.
 */
export class OTP extends BaseModel {
  /** The auth collection id. */
  collectionId = ''

  /** The auth record id (may be empty if not yet linked). */
  recordId = ''

  /** The OTP password hash. */
  passwordHash = ''

  /** Whether the OTP has been used. */
  used = false

  /** The timestamp when this OTP expires. */
  expiresAt: DateTime = new DateTime(null)

  /** Number of failed attempts. */
  failedAttempts = 0

  override tableName(): string {
    return '_otps'
  }
}
