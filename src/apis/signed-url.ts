/**
 * HMAC-signed storage URLs.
 *
 * Replaces plain-path "signed URLs" with cryptographically signed tokens.
 * Each token carries an HMAC-SHA256 signature over a base64url-encoded
 * JSON payload of {bucket, path, exp}.  The signing secret comes from
 * the JWT_SECRET environment variable.
 *
 * Token format:
 *   <base64url({bucket,path,exp})>.<base64url(HMAC-SHA256(payload, secret))>
 *
 * No Bearer auth is needed when consuming the token — the HMAC signature
 * IS the authorization.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default TTL when expiresIn is not provided. */
const DEFAULT_TTL_SEC = 60 * 60 // 1 hour

/** Dev fallback — matches auth-jwt.ts JWT_DEV_FALLBACK. */
const JWT_DEV_FALLBACK = 'sinopebase-dev-jwt-secret-min-32-chars!!'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getSecret(): string {
  return process.env.JWT_SECRET ?? JWT_DEV_FALLBACK
}

function base64urlEncode(buf: Buffer): string {
  return buf.toString('base64url')
}

function base64urlDecode(str: string): Buffer {
  return Buffer.from(str, 'base64url')
}

function computeSignature(payloadB64: string, secret: string): string {
  const hmac = createHmac('sha256', secret)
  hmac.update(payloadB64, 'utf-8')
  return base64urlEncode(hmac.digest())
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create an HMAC-signed token for the given storage bucket and path.
 *
 * @param bucket       Storage bucket name.
 * @param path         Object path within the bucket.
 * @param expiresInSec Token lifetime in seconds (defaults to 1 hour).
 * @returns            A signed token string: `payload.signature`.
 */
export function signUrl(
  bucket: string,
  path: string,
  expiresInSec: number = DEFAULT_TTL_SEC,
): string {
  const exp = Math.floor(Date.now() / 1000) + expiresInSec
  const payload = { bucket, path, exp }
  const payloadB64 = base64urlEncode(Buffer.from(JSON.stringify(payload), 'utf-8'))
  const secret = getSecret()
  const sig = computeSignature(payloadB64, secret)
  return `${payloadB64}.${sig}`
}

/**
 * Verify an HMAC-signed token and return the embedded bucket + path.
 *
 * @param token  The signed token string.
 * @returns      `{ bucket, path }` from the verified payload.
 * @throws       SignedUrlError on expiry, tampering, or malformed input.
 */
export function verifySignedUrl(token: string): { bucket: string; path: string } {
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
  let payload: { bucket: string; path: string; exp: number }
  try {
    const raw = base64urlDecode(payloadB64)
    const parsed = JSON.parse(raw.toString('utf-8'))
    if (typeof parsed !== 'object' || parsed === null) {
      throw new SignedUrlError('Malformed payload')
    }
    payload = parsed as { bucket: string; path: string; exp: number }
  } catch (err) {
    if (err instanceof SignedUrlError) throw err
    throw new SignedUrlError('Malformed payload')
  }

  // Check expiry.
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
    throw new SignedUrlError('Malformed payload')
  }
  const now = Math.floor(Date.now() / 1000)
  if (payload.exp < now) {
    throw new SignedUrlError('Token expired')
  }

  // Validate required fields.
  if (typeof payload.bucket !== 'string' || !payload.bucket) {
    throw new SignedUrlError('Malformed payload')
  }
  if (typeof payload.path !== 'string' || !payload.path) {
    throw new SignedUrlError('Malformed payload')
  }

  // Verify the HMAC signature in constant time.
  const secret = getSecret()
  const expectedSig = computeSignature(payloadB64, secret)

  const sigBuf = base64urlDecode(sig)
  const expectedBuf = base64urlDecode(expectedSig)

  if (sigBuf.length !== expectedBuf.length) {
    throw new SignedUrlError('Invalid signature')
  }

  if (!timingSafeEqual(sigBuf, expectedBuf)) {
    throw new SignedUrlError('Invalid signature')
  }

  return { bucket: payload.bucket, path: payload.path }
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
