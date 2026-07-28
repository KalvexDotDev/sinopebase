/**
 * Column-level AES-256-GCM encryption.
 *
 * Port of PocketBase tools/security/encrypt.go
 * Layer 0 — zero internal dependencies.
 *
 * Uses AES-256-GCM (Galois/Counter Mode) which provides
 * authenticated encryption (confidentiality + integrity).
 *
 * Format: base64( nonce(12) || ciphertext || authTag(16) )
 *
 * The nonce is randomly generated on every encryption call and
 * prepended to the ciphertext, matching Go's `cipher.NewGCM` +
 * `gcm.Seal(nonce, nonce, data, nil)` convention.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** AES-256-GCM algorithm identifier for Node/Bun crypto. */
const ALGORITHM = 'aes-256-gcm'

/** GCM standard nonce (IV) size in bytes — 12 bytes (96 bits). */
const IV_LENGTH = 12

/** GCM authentication tag size in bytes — 16 bytes (128 bits). */
const TAG_LENGTH = 16

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encrypt `data` using AES-256-GCM with the provided key.
 *
 * @param data   Plaintext bytes to encrypt.
 * @param key    AES key — must be exactly 32 characters (256 bits).
 * @returns      Base64-encoded ciphertext: `nonce || ciphertext || authTag`.
 */
export function Encrypt(data: Uint8Array, key: string): string {
  if (key.length !== 32) {
    throw new RangeError('AES key must be exactly 32 characters (256 bits)')
  }

  const keyBuffer = Buffer.from(key, 'utf-8')
  const iv = randomBytes(IV_LENGTH)

  const cipher = createCipheriv(ALGORITHM, keyBuffer, iv)

  const encrypted = Buffer.concat([cipher.update(data), cipher.final()])
  const tag = cipher.getAuthTag()

  // Format: iv(12) || ciphertext || tag(16)
  return Buffer.concat([iv, encrypted, tag]).toString('base64')
}

/**
 * Decrypt a base64-encoded ciphertext produced by {@link Encrypt}.
 *
 * @param cipherText  Base64-encoded ciphertext: `nonce || ciphertext || authTag`.
 * @param key         AES key — must be exactly 32 characters (256 bits).
 * @returns           Decrypted plaintext bytes.
 */
export function Decrypt(cipherText: string, key: string): Buffer {
  if (key.length !== 32) {
    throw new RangeError('AES key must be exactly 32 characters (256 bits)')
  }

  const keyBuffer = Buffer.from(key, 'utf-8')

  const data = Buffer.from(cipherText, 'base64')

  if (data.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('ciphertext too short')
  }

  const iv = data.subarray(0, IV_LENGTH)
  const tag = data.subarray(data.length - TAG_LENGTH)
  const encrypted = data.subarray(IV_LENGTH, data.length - TAG_LENGTH)

  const decipher = createDecipheriv(ALGORITHM, keyBuffer, iv) // nosemgrep: gcm-no-tag-length
  decipher.setAuthTag(tag)

  return Buffer.concat([decipher.update(encrypted), decipher.final()])
}
