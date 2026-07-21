/**
 * Cryptographic hash / HMAC / verification utilities.
 *
 * Port of PocketBase tools/security/crypto.go
 * Layer 0 — zero internal dependencies.
 *
 * All hash functions return hex-encoded strings, matching Go's
 * `fmt.Sprintf("%x", h.Sum(nil))` convention.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// ---------------------------------------------------------------------------
// SHA-256 challenge (RFC 7636)
// ---------------------------------------------------------------------------

/**
 * Create a base64url-encoded SHA-256 challenge string from a code verifier,
 * stripping padding characters per RFC 7636 (PKCE).
 *
 * Equivalent to Go's `S256Challenge`.
 */
export function S256Challenge(code: string): string {
  const hash = createHash('sha256').update(code, 'utf-8').digest();
  return hash
    .toString('base64url')
    .replace(/=+$/, '');
}

// ---------------------------------------------------------------------------
// Hash digests (hex-encoded)
// ---------------------------------------------------------------------------

/**
 * Compute the MD5 digest of `text` as a hex string.
 */
export function MD5(text: string): string {
  return createHash('md5').update(text, 'utf-8').digest('hex');
}

/**
 * Compute the SHA-256 digest of `text` as a hex string.
 */
export function SHA256(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

/**
 * Compute the SHA-512 digest of `text` as a hex string.
 */
export function SHA512(text: string): string {
  return createHash('sha512').update(text, 'utf-8').digest('hex');
}

// ---------------------------------------------------------------------------
// HMAC digests (hex-encoded)
// ---------------------------------------------------------------------------

/**
 * Compute HMAC-SHA256 of `text` with the given `secret` as a hex string.
 */
export function HS256(text: string, secret: string): string {
  return createHmac('sha256', secret).update(text, 'utf-8').digest('hex');
}

/**
 * Compute HMAC-SHA512 of `text` with the given `secret` as a hex string.
 */
export function HS512(text: string, secret: string): string {
  return createHmac('sha512', secret).update(text, 'utf-8').digest('hex');
}

// ---------------------------------------------------------------------------
// Constant-time comparison
// ---------------------------------------------------------------------------

/**
 * Compare two strings in constant time to avoid timing side-channel attacks.
 *
 * If the strings have different lengths, the comparison still consumes a
 * constant-time operation on the overlapping portion before returning false.
 *
 * Equivalent to Go's `subtle.ConstantTimeCompare`.
 */
export function Equal(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf-8');
  const bBuf = Buffer.from(b, 'utf-8');

  if (aBuf.length !== bBuf.length) {
    // Compare the shared-length prefix in constant time to prevent
    // a timing side-channel that would leak the length difference.
    const minLen = Math.min(aBuf.length, bBuf.length);
    timingSafeEqual(aBuf.subarray(0, minLen), bBuf.subarray(0, minLen));
    return false;
  }

  return timingSafeEqual(aBuf, bBuf);
}
