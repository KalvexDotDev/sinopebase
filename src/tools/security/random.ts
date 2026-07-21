/**
 * Secure random string generation.
 *
 * Port of PocketBase tools/security/random.go
 * Layer 0 — zero internal dependencies.
 *
 * Uses Bun's `crypto.getRandomValues()` (Web Crypto API)
 * for cryptographically secure randomness and `Math.random()`
 * for fast but non-cryptographic pseudorandom strings.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default alphanumeric alphabet: [A-Za-z0-9].
 */
const DEFAULT_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Generate a cryptographically secure random integer in [0, max).
 *
 * Uses rejection sampling to avoid modulo bias, matching Go's
 * `crypto/rand.Int` behaviour.
 */
function cryptoRandomInt(max: number): number {
  if (max <= 0) {
    throw new RangeError('max must be positive');
  }
  if (max === 1) return 0;

  const byteLimit = 256 - (256 % max);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const byte = crypto.getRandomValues(new Uint8Array(1))[0]!;
    if (byte < byteLimit) return byte % max;
  }
}

// ---------------------------------------------------------------------------
// Cryptographically secure random strings
// ---------------------------------------------------------------------------

/**
 * Generate a cryptographically secure random alphanumeric string.
 *
 * The generated string matches [A-Za-z0-9]+ and is safe for URL-encoding.
 */
export function RandomString(length: number): string {
  return RandomStringWithAlphabet(length, DEFAULT_ALPHABET);
}

/**
 * Generate a cryptographically secure random string using a custom alphabet.
 *
 * Uses rejection sampling (unbiased) via `crypto.getRandomValues()`.
 * Panics (throws) if an error occurs during random number generation,
 * matching Go's panic-on-error behaviour.
 */
export function RandomStringWithAlphabet(length: number, alphabet: string): string {
  if (alphabet.length === 0) {
    throw new RangeError('alphabet must not be empty');
  }

  const result = new Array<string>(length);
  const alphabetLen = alphabet.length;

  for (let i = 0; i < length; i++) {
    result[i] = alphabet[cryptoRandomInt(alphabetLen)]!;
  }

  return result.join('');
}

// ---------------------------------------------------------------------------
// Fast pseudorandom strings (non-cryptographic)
// ---------------------------------------------------------------------------

/**
 * Generate a fast pseudorandom alphanumeric string using `Math.random()`.
 *
 * This is NOT cryptographically secure.
 * For a secure alternative use {@link RandomString}.
 */
export function PseudorandomString(length: number): string {
  return PseudorandomStringWithAlphabet(length, DEFAULT_ALPHABET);
}

/**
 * Generate a fast pseudorandom string using a custom alphabet and `Math.random()`.
 *
 * This is NOT cryptographically secure.
 * For a secure alternative use {@link RandomStringWithAlphabet}.
 */
export function PseudorandomStringWithAlphabet(length: number, alphabet: string): string {
  if (alphabet.length === 0) {
    throw new RangeError('alphabet must not be empty');
  }

  const result = new Array<string>(length);
  const alphabetLen = alphabet.length;

  for (let i = 0; i < length; i++) {
    result[i] = alphabet[Math.floor(Math.random() * alphabetLen)]!;
  }

  return result.join('');
}
