/**
 * JWT token creation and parsing using HS256.
 *
 * Port of PocketBase tools/security/jwt.go
 * Layer 0 — zero internal dependencies (external: `jose` npm package).
 *
 * Uses the `jose` library (v6+) for JWT signing and verification.
 * All tokens use HS256 (HMAC with SHA-256) symmetric signing.
 */

import { SignJWT, jwtVerify, decodeJwt } from 'jose';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Convert a string key to a Uint8Array for use with jose.
 */
function keyToBytes(key: string): Uint8Array {
  return new TextEncoder().encode(key);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new signed JWT token.
 *
 * The token is signed with HS256 using the provided `signingKey`.
 * An `exp` (expiration) claim is set to `now + durationMs`.
 * If the `payload` already contains an `exp` claim it will be
 * overridden by the automatically computed one, matching Go's
 * behaviour of setting `exp` first then merging payload on top.
 *
 * @param payload     Custom claims to include in the token.
 * @param signingKey  HMAC signing key (UTF-8 string).
 * @param durationMs  Token lifetime in milliseconds.
 * @returns           The signed JWT string.
 */
export async function NewJWT(
  payload: Record<string, unknown>,
  signingKey: string,
  durationMs: number,
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + Math.floor(durationMs / 1000);

  // Build claims: start with `exp`, merge payload on top
  // (matches Go's `claims["exp"] = ...; for k,v := range payload { claims[k] = v }`)
  const claims: Record<string, unknown> = {
    exp,
    ...payload,
  };

  const jwt = await new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .sign(keyToBytes(signingKey));

  return jwt;
}

/**
 * Parse and verify a JWT token.
 *
 * The token must be signed with HS256 using the provided `verificationKey`.
 * `exp` (expiration), `nbf` (not before), and `iat` (issued at) claims
 * are automatically validated by jose.
 *
 * @param token           The JWT string to parse.
 * @param verificationKey HMAC verification key (UTF-8 string).
 * @returns               The decoded payload claims.
 * @throws                If verification or claim validation fails.
 */
export async function ParseJWT(
  token: string,
  verificationKey: string,
): Promise<Record<string, unknown>> {
  const { payload } = await jwtVerify(
    token,
    keyToBytes(verificationKey),
    { algorithms: ['HS256'] },
  );

  return payload as unknown as Record<string, unknown>;
}

/**
 * Parse a JWT token WITHOUT verifying its signature.
 *
 * Only the `exp` (expiration), `iat` (issued at), and `nbf` (not before)
 * claims are validated. The signature is NOT checked.
 *
 * **WARNING:** This function should ONLY be used when you need to read
 * the claims of a token that has already been verified through another
 * channel, or for debugging purposes.
 *
 * @param token  The JWT string to decode.
 * @returns      The decoded payload claims.
 * @throws       If the token is malformed or claim validation fails.
 */
export function ParseUnverifiedJWT(
  token: string,
): Record<string, unknown> {
  const payload = decodeJwt(token);

  const now = Math.floor(Date.now() / 1000);

  // Verify `exp` (expiration)
  if (typeof payload.exp === 'number' && payload.exp < now) {
    throw new Error('token has expired');
  }

  // Verify `nbf` (not before)
  if (typeof payload.nbf === 'number' && payload.nbf > now) {
    throw new Error('token is not valid yet (nbf)');
  }

  // Verify `iat` (issued at) — must not be in the future
  // Uses a 1-second tolerance for clock skew
  if (typeof payload.iat === 'number' && payload.iat > now + 1) {
    throw new Error('token issued in the future');
  }

  return payload as unknown as Record<string, unknown>;
}
