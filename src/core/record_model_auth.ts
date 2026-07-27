/**
 * Record auth methods — Email, password, token key management.
 *
 * Port of PocketBase's core/record_model_auth.go (Go -> TypeScript).
 * Layer 2 — imports from ~/tools/security.
 */

import {
  FieldNameEmail,
  FieldNameEmailVisibility,
  FieldNamePassword,
  FieldNameTokenKey,
  FieldNameVerified,
  type Record as RecordModel,
} from '~/core/record_model.ts'
import { RandomString } from '~/tools/security/random.ts'

// ---------------------------------------------------------------------------
// Auto-generate modifier suffix
// ---------------------------------------------------------------------------

/**
 * Suffix appended to field names to trigger auto-generation.
 *
 * Example: setting "tokenKey+" to "" will auto-generate a new token key.
 */
const AutogenerateModifier = '+'

// ---------------------------------------------------------------------------
// AuthRecord mixin methods (applied via module augmentation)
// ---------------------------------------------------------------------------

/**
 * Returns the record's email address.
 */
export function recordEmail(record: RecordModel): string {
  return record.getString(FieldNameEmail)
}

/**
 * Sets the record's email address.
 */
export function setRecordEmail(record: RecordModel, email: string): void {
  record.set(FieldNameEmail, email)
}

/**
 * Returns whether the email is publicly visible.
 */
export function recordEmailVisibility(record: RecordModel): boolean {
  return record.getBool(FieldNameEmailVisibility)
}

/**
 * Sets whether the email is publicly visible.
 */
export function setRecordEmailVisibility(record: RecordModel, visible: boolean): void {
  record.set(FieldNameEmailVisibility, visible)
}

/**
 * Returns whether the record is verified.
 */
export function recordVerified(record: RecordModel): boolean {
  return record.getBool(FieldNameVerified)
}

/**
 * Sets whether the record is verified.
 */
export function setRecordVerified(record: RecordModel, verified: boolean): void {
  record.set(FieldNameVerified, verified)
}

/**
 * Returns the token key used for JWT signing.
 */
export function recordTokenKey(record: RecordModel): string {
  return record.getString(FieldNameTokenKey)
}

/**
 * Sets the token key.
 */
export function setRecordTokenKey(record: RecordModel, key: string): void {
  record.set(FieldNameTokenKey, key)
}

/**
 * Refreshes the token key by triggering auto-generation.
 *
 * This uses the "+" modifier suffix to signal that the token key
 * should be auto-generated on the next DB write.
 */
export function refreshRecordTokenKey(record: RecordModel): void {
  record.set(FieldNameTokenKey + AutogenerateModifier, '')
}

/**
 * Sets a password on the record.
 *
 * The password is hashed and stored. The token key is also refreshed
 * automatically during the next DB write.
 */
export function setRecordPassword(record: RecordModel, password: string): void {
  record.set(FieldNamePassword, password)
}

/**
 * Generates and sets a random password (30 chars).
 *
 * Used for auto-created OTP or OAuth2 user flows.
 * The plain text value is cleared after setting to skip validators.
 *
 * @returns The generated random password (plain text).
 */
export function setRecordRandomPassword(record: RecordModel): string {
  const pass = RandomString(30)
  record.set(FieldNamePassword, pass)
  refreshRecordTokenKey(record)
  // Clear the plain value to skip field validators on save
  const raw = record.getRaw(FieldNamePassword)
  if (raw && typeof raw === 'object' && 'plain' in (raw as Record<string, unknown>)) {
    ;(raw as Record<string, string>).plain = ''
  }
  return pass
}

/**
 * Validates a plain-text password against the stored hash.
 *
 * @returns true if the password is valid.
 */
export function validateRecordPassword(record: RecordModel, password: string): boolean {
  const pv = record.getRaw(FieldNamePassword)
  if (!pv || typeof pv !== 'object') return false
  // Password validation delegates to the field value implementation
  // For now, do a basic check
  if (typeof (pv as Record<string, unknown>).validate === 'function') {
    return (pv as { validate: (pwd: string) => boolean }).validate(password)
  }
  return false
}
