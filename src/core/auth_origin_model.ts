/**
 * AuthOrigin model for tracking auth origin/fingerprint.
 *
 * Port of PocketBase's models (Go -> TypeScript).
 *
 * AuthOrigin represents the origin/fingerprint of an auth record,
 * used for tracking login sessions and devices.
 */

import { BaseModel } from './db_model'

/**
 * AuthOrigin represents the origin/fingerprint of an authentication.
 */
export class AuthOrigin extends BaseModel {
  /** The auth collection id. */
  collectionId = ''

  /** The auth record id. */
  recordId = ''

  /** The device/browser fingerprint. */
  fingerprint = ''

  /** The IP address of the origin. */
  ip = ''

  override tableName(): string {
    return '_authOrigins'
  }
}
