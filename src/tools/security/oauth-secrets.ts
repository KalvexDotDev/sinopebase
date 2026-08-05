/**
 * OAuth client-secret encryption using AES-256-GCM with HKDF key derivation.
 *
 * The master key is derived from JWT_SECRET via HKDF-SHA256.
 * Encrypted values are prefixed with `$aesgcm:` for easy identification
 * and backward-compatible migration from plaintext.
 *
 * Atomic writes are the responsibility of the caller (admin-oauth.ts).
 *
 * Layer 0 — depends only on Node crypto and `./encrypt`.
 */

import { createHmac } from 'node:crypto'
import { Decrypt, Encrypt } from './encrypt'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Prefix for encrypted values — makes migration from plaintext trivial. */
const ENCRYPTED_PREFIX = '$aesgcm:'

/** HKDF salt — deterministic so the same JWT_SECRET always produces the same key. */
const HKDF_SALT = 'sinopebase-oauth-secrets'

/** Minimum JWT_SECRET length for production. */
const MIN_SECRET_LENGTH = 32

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

/**
 * Derive a 32-character key from JWT_SECRET via HKDF-SHA256.
 *
 * The HKDF output is hex-encoded and truncated to 32 characters,
 * which is the exact length the existing `Encrypt`/`Decrypt` functions expect.
 */
function deriveKeyStr(masterSecret: string): string {
  const salt = Buffer.from(HKDF_SALT, 'utf-8')
  const ikm = Buffer.from(masterSecret, 'utf-8')

  // HKDF-Extract: PRK = HMAC-SHA256(salt, IKM)
  const prk = createHmac('sha256', salt).update(ikm).digest()
  // HKDF-Expand: OKM = HMAC(PRK, info || 0x01)
  const info = Buffer.from('sinopebase-oauth-encryption', 'utf-8')
  const okm = createHmac('sha256', prk)
    .update(Buffer.concat([info, Buffer.from([0x01])]))
    .digest()

  // Hex-encode (64 chars) and take first 32 = 128 bits
  return okm.toString('hex').slice(0, 32)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encrypt a client secret for storage.
 *
 * Returns `$aesgcm:<base64-ciphertext>`.
 * Derives the AES key from JWT_SECRET via HKDF.
 */
export function encryptClientSecret(plaintext: string, jwtSecret: string): string {
  if (!jwtSecret || jwtSecret.length < MIN_SECRET_LENGTH) {
    throw new Error('JWT_SECRET must be at least 32 characters for OAuth encryption')
  }
  const key = deriveKeyStr(jwtSecret)
  const encrypted = Encrypt(Buffer.from(plaintext, 'utf-8'), key)
  return `${ENCRYPTED_PREFIX}${encrypted}`
}

/**
 * Decrypt a client secret read from storage.
 *
 * Handles both encrypted (`$aesgcm:...`) and plaintext values
 * for backward-compatible migration.
 */
export function decryptClientSecret(stored: string, jwtSecret: string): string {
  if (!stored) return stored

  // If already encrypted, decrypt it
  if (stored.startsWith(ENCRYPTED_PREFIX)) {
    if (!jwtSecret || jwtSecret.length < MIN_SECRET_LENGTH) {
      throw new Error('JWT_SECRET must be at least 32 characters for OAuth decryption')
    }
    const key = deriveKeyStr(jwtSecret)
    const ciphertext = stored.slice(ENCRYPTED_PREFIX.length)
    return Decrypt(ciphertext, key).toString('utf-8')
  }

  // Plaintext — existing data before encryption was enabled
  return stored
}

/**
 * Check whether a stored secret is already encrypted.
 */
export function isEncrypted(stored: string): boolean {
  return stored.startsWith(ENCRYPTED_PREFIX)
}
