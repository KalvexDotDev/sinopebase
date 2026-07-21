/**
 * Generate random strings that match a given regex pattern.
 *
 * Port of PocketBase tools/security/random_by_regex.go
 * Layer 0 — zero internal dependencies (external: `randexp` npm package).
 *
 * Used by the `autogeneratePattern` field option to generate
 * random field values that conform to a regex pattern.
 *
 * WARNING: While randomness comes from `crypto.randomInt`,
 * this method is not recommended for use in critical security
 * contexts on its own due to potentially variable generated length.
 */

import { randomInt } from 'node:crypto';
import RandExp from 'randexp';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a random string that matches the given regex pattern.
 *
 * Supports most common regex constructs including character classes,
 * alternation, repetition (`*`, `+`, `?`, `{n}`, `{n,m}`), groups,
 * and shorthand classes (`\d`, `\w`, `\s`, etc.).
 *
 * @param pattern   The regex pattern string (e.g. `[a-z]{5}[0-9]{3}`).
 * @param maxRepeat Optional cap for unbounded repetitions (`*`, `+`).
 *                  Defaults to 100. Go's PocketBase uses 6 internally.
 * @returns         A randomly generated string matching the pattern.
 * @throws          If the pattern is invalid or unsupported.
 */
export function RandomStringByRegex(
  pattern: string,
  maxRepeat?: number,
): string {
  const randexp = new RandExp(pattern);

  // Override randInt to use cryptographically secure randomness,
  // matching Go's use of `crypto/rand` in random_by_regex.go.
  randexp.randInt = (from: number, to: number): number => {
    // crypto.randomInt(min, max) returns [min, max) — exclusive of max.
    // RandExp expects [from, to] inclusive, so we pass to + 1.
    return randomInt(from, to + 1);
  };

  // Cap unbounded repetitions (`*`, `+`, `{n,}`) to limit output length
  if (maxRepeat !== undefined) {
    randexp.max = maxRepeat;
  }

  return randexp.gen();
}
