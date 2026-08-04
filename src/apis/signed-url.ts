/**
 * HMAC-signed storage URLs — stateless, reusable tokens.
 *
 * Each token carries an HMAC-SHA256 signature over a base64url-encoded
 * JSON payload of {bucket, path, exp, kid, method}.  The signing key is
 * derived per-bucket via HKDF from the JWT_SECRET master secret.
 *
 * Token format:
 *   <base64url({bucket,path,exp,kid,method})>.<base64url(HMAC)>
 *
 * No Bearer auth is needed when consuming the token — the HMAC signature
 * IS the authorization.
 *
 * Features:
 * - kid (key ID) for rotation support
 * - method claim ("GET" | "PUT") to scope tokens to specific operations
 * - Per-bucket key derivation via HKDF
 * - Stateless verification — tokens are reusable within their expiry window
 *   (Supabase-compatible: no server-side nonce / replay detection)
 */

import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'
import { JWT_DEV_FALLBACK } from '~/tools/security/constants'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default TTL when expiresIn is not provided. */
const DEFAULT_TTL_SEC = 60 * 60 // 1 hour

/** Current key ID — bump when the HKDF info string or algorithm changes. */
const DEFAULT_KEY_ID = 'sinopebase-v1'

/** Set of known/trusted key IDs.  Rotate by adding new IDs and removing old. */
const KNOWN_KEY_IDS = new Set<string>([DEFAULT_KEY_ID])

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

function getSecret(): string {
  return process.env.JWT_SECRET ?? JWT_DEV_FALLBACK
}

/**
 * Derive a per-bucket HMAC key from the master secret using HKDF-SHA256.
 *
 * The `info` parameter incorporates both the domain ("sinopebase:signed-url")
 * and the bucket name, so a key compromised from one bucket cannot be used
 * to forge tokens for another bucket.
 */
function deriveKey(bucket: string): Buffer {
  const master = Buffer.from(getSecret(), 'utf-8')
  const info = `sinopebase:signed-url:${bucket}:v1`
  return Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), info, 32))
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function base64urlEncode(buf: Buffer): string {
  return buf.toString('base64url')
}

function base64urlDecode(str: string): Buffer {
  return Buffer.from(str, 'base64url')
}

function computeSignature(payloadB64: string, key: Buffer): string {
  const hmac = createHmac('sha256', key)
  hmac.update(payloadB64, 'utf-8')
  return base64urlEncode(hmac.digest())
}

// ---------------------------------------------------------------------------
// Token creation
// ---------------------------------------------------------------------------

/**
 * Create an HMAC-signed token for reading the given storage bucket and path.
 *
 * @param bucket       Storage bucket name.
 * @param path         Object path within the bucket.
 * @param expiresInSec Token lifetime in seconds (defaults to 1 hour).
 * @param method       HTTP method the token is scoped to ("GET" or "PUT").
 * @returns            A signed token string: `<payload>.<signature>`.
 */
export function signUrl(
  bucket: string,
  path: string,
  expiresInSec: number = DEFAULT_TTL_SEC,
  method: 'GET' | 'PUT' = 'GET',
): string {
  const exp = Math.floor(Date.now() / 1000) + expiresInSec
  const payload = {
    bucket,
    path,
    exp,
    kid: DEFAULT_KEY_ID,
    method,
  }
  const payloadB64 = base64urlEncode(Buffer.from(JSON.stringify(payload), 'utf-8'))
  const key = deriveKey(bucket)
  const sig = computeSignature(payloadB64, key)
  return `${payloadB64}.${sig}`
}

/**
 * Create an HMAC-signed token for **uploading** to the given bucket and path.
 *
 * Behaves like `signUrl` but defaults `method` to `"PUT"`.
 *
 * @param bucket       Storage bucket name.
 * @param path         Object path within the bucket.
 * @param expiresInSec Token lifetime in seconds (defaults to 1 hour).
 * @returns            A signed token string scoped to PUT.
 */
export function uploadUrl(
  bucket: string,
  path: string,
  expiresInSec: number = DEFAULT_TTL_SEC,
): string {
  return signUrl(bucket, path, expiresInSec, 'PUT')
}

// ---------------------------------------------------------------------------
// Token verification
// ---------------------------------------------------------------------------

export interface VerifiedToken {
  bucket: string
  path: string
  method: string
}

/**
 * Verify an HMAC-signed token and return the embedded claims.
 *
 * Validation steps:
 * 1. Token structure (payload.signature)
 * 2. Payload is valid JSON with all required fields
 * 3. `kid` is a known key ID
 * 4. `method` is "GET" or "PUT"
 * 5. `exp` is not past
 * 6. HMAC signature matches (per-bucket derived key)
 * 7. Token is stateless — reusable within expiry (no replay detection)
 *
 * @param token  The signed token string.
 * @returns      `{ bucket, path, method }` from the verified payload.
 * @throws       SignedUrlError on any verification failure.
 */
export function verifySignedUrl(token: string): VerifiedToken {
  const dotIndex = token.lastIndexOf('.')
  if (dotIndex === -1 || dotIndex === 0 || dotIndex === token.length - 1) {
    throw new SignedUrlError('Malformed token')
  }

  const payloadB64 = token.slice(0, dotIndex)
  const sig = token.slice(dotIndex + 1)

  if (!payloadB64 || !sig) {
    throw new SignedUrlError('Malformed token')
  }

  // Decode the JSON payload.
  let payload: Record<string, unknown>
  try {
    const raw = base64urlDecode(payloadB64)
    const parsed = JSON.parse(raw.toString('utf-8'))
    if (typeof parsed !== 'object' || parsed === null) {
      throw new SignedUrlError('Malformed payload')
    }
    payload = parsed as Record<string, unknown>
  } catch (err) {
    if (err instanceof SignedUrlError) throw err
    throw new SignedUrlError('Malformed payload')
  }

  // --- Structural validation ---

  if (typeof payload.bucket !== 'string' || !payload.bucket) {
    throw new SignedUrlError('Malformed payload')
  }
  if (typeof payload.path !== 'string' || !payload.path) {
    throw new SignedUrlError('Malformed payload')
  }
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
    throw new SignedUrlError('Malformed payload')
  }
  if (typeof payload.kid !== 'string' || !payload.kid) {
    throw new SignedUrlError('Malformed payload')
  }
  if (
    typeof payload.method !== 'string' ||
    (payload.method !== 'GET' && payload.method !== 'PUT')
  ) {
    throw new SignedUrlError('Malformed payload')
  }

  // --- Key ID ---
  if (!KNOWN_KEY_IDS.has(payload.kid)) {
    throw new SignedUrlError('Unknown key ID')
  }

  // --- Expiry ---
  const now = Math.floor(Date.now() / 1000)
  if (payload.exp < now) {
    throw new SignedUrlError('Token expired')
  }

  // --- HMAC verification ---
  const key = deriveKey(payload.bucket)
  const expectedSig = computeSignature(payloadB64, key)

  const sigBuf = base64urlDecode(sig)
  const expectedBuf = base64urlDecode(expectedSig)

  if (sigBuf.length !== expectedBuf.length) {
    throw new SignedUrlError('Invalid signature')
  }

  if (!timingSafeEqual(sigBuf, expectedBuf)) {
    throw new SignedUrlError('Invalid signature')
  }

  return { bucket: payload.bucket, path: payload.path, method: payload.method }
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/**
 * Error thrown when a signed URL token cannot be verified.
 */
export class SignedUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SignedUrlError'
  }
}
