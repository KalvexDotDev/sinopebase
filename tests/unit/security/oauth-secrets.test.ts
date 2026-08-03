/**
 * Unit tests for OAuth client-secret encryption (src/tools/security/oauth-secrets.ts).
 *
 * Verifies:
 *   - Round-trip encrypt/decrypt with valid key
 *   - Different keys produce different ciphertexts
 *   - Different plaintexts produce different ciphertexts
 *   - Backward-compatible plaintext passthrough
 *   - Empty string passthrough
 *   - Too-short JWT_SECRET rejection
 *   - Corruption detection
 */

import { describe, expect, test } from 'bun:test'
import {
  decryptClientSecret,
  encryptClientSecret,
  isEncrypted,
} from '~/tools/security/oauth-secrets'

const JWT_SECRET = 'this-is-a-very-long-jwt-secret-min-32-chars'

describe('oauth-secrets encrypt/decrypt', () => {
  test('round-trip: encrypt then decrypt returns original', () => {
    const plaintext = 'my-super-secret-client-secret-value'
    const encrypted = encryptClientSecret(plaintext, JWT_SECRET)
    expect(encrypted).toStartWith('$aesgcm:')
    expect(isEncrypted(encrypted)).toBe(true)

    const decrypted = decryptClientSecret(encrypted, JWT_SECRET)
    expect(decrypted).toBe(plaintext)
  })

  test('different keys produce different ciphertexts', () => {
    const plaintext = 'test-secret'
    const a = encryptClientSecret(plaintext, 'key-a-minimum-32-chars-long-xx!!')
    const b = encryptClientSecret(plaintext, 'key-b-minimum-32-chars-long-xx!!')
    expect(a).not.toBe(b)
    // Decrypting with wrong key should fail
    expect(() => decryptClientSecret(a, 'key-b-minimum-32-chars-long-xx!!')).toThrow()
  })

  test('different plaintexts produce different ciphertexts', () => {
    const a = encryptClientSecret('secret-one', JWT_SECRET)
    const b = encryptClientSecret('secret-two', JWT_SECRET)
    expect(a).not.toBe(b)
  })

  test('backward-compatible: plaintext values pass through', () => {
    const plaintext = 'legacy-plaintext-secret'
    const result = decryptClientSecret(plaintext, JWT_SECRET)
    expect(result).toBe(plaintext)
    expect(isEncrypted(plaintext)).toBe(false)
  })

  test('empty string passes through without error', () => {
    expect(decryptClientSecret('', JWT_SECRET)).toBe('')
    expect(isEncrypted('')).toBe(false)
  })

  test('throws on too-short JWT_SECRET', () => {
    expect(() => encryptClientSecret('test', 'short-key')).toThrow(
      'JWT_SECRET must be at least 32 characters',
    )
  })

  test('corrupted ciphertext throws on decrypt', () => {
    const encrypted = encryptClientSecret('test-secret', JWT_SECRET)
    // Corrupt the base64 payload
    const corrupted = `${encrypted.slice(0, -4)}XXXX`
    expect(() => decryptClientSecret(corrupted, JWT_SECRET)).toThrow()
  })

  test('each encryption uses unique nonce (different ciphertexts each time)', () => {
    const plaintext = 'same-secret'
    const a = encryptClientSecret(plaintext, JWT_SECRET)
    const b = encryptClientSecret(plaintext, JWT_SECRET)
    // Same plaintext, same key → different ciphertext due to random nonce
    expect(a).not.toBe(b)
    // But both decrypt to the same value
    expect(decryptClientSecret(a, JWT_SECRET)).toBe(plaintext)
    expect(decryptClientSecret(b, JWT_SECRET)).toBe(plaintext)
  })
})
