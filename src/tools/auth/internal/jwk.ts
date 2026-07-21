/**
 * JWK (JSON Web Key) fetching and caching.
 *
 * Port of PocketBase's internal JWK utilities.
 * Layer 1 -- fetches JWK sets from provider URLs and returns CryptoKey
 * objects suitable for JWT verification (e.g. Apple, OIDC).
 *
 * Uses the `jose` library (Layer 0 external dependency).
 */

import { importJWK } from 'jose'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * JWK represents a single JSON Web Key as returned by a JWKS endpoint.
 */
interface JWK {
  kty: string
  kid?: string
  use?: string
  n?: string
  e?: string
  alg?: string
  x?: string
  y?: string
  crv?: string
  [key: string]: unknown
}

/**
 * JWKS is a JWK Set -- a collection of public keys.
 */
interface JWKS {
  keys: JWK[]
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CachedKey {
  key: CryptoKey
  kid: string
}

const keyCache = new Map<string, CachedKey>()

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * FetchJWK fetches a JWK Set from the given URL, finds the key matching
 * the optional `kid` (key ID), imports it as a CryptoKey, and caches it.
 *
 * If no `kid` is provided the first key in the set is returned.
 * Subsequent calls with the same URL + kid combo return the cached key.
 *
 * @param url The JWKS endpoint URL.
 * @param kid Optional key ID to select a specific key.
 * @returns   A CryptoKey suitable for JWT verification.
 */
export async function FetchJWK(url: string, kid?: string): Promise<CryptoKey> {
  const cacheKey = kid ? `${url}#${kid}` : url
  const cached = keyCache.get(cacheKey)
  if (cached) {
    return cached.key
  }

  const jwks = await fetchJWKSet(url)

  let jwk: JWK | undefined
  if (kid) {
    jwk = jwks.keys.find((k) => k.kid === kid)
    if (!jwk) {
      throw new Error(`JWK key with kid '${kid}' not found at ${url}`)
    }
  } else {
    jwk = jwks.keys[0]
    if (!jwk) {
      throw new Error(`No JWK keys found at ${url}`)
    }
  }

  const key = (await importJWK(jwk as unknown as Record<string, unknown>, jwk.alg)) as CryptoKey
  keyCache.set(cacheKey, { key, kid: jwk.kid ?? '' })
  return key
}

/**
 * ClearJWKCache empties the internal JWK key cache.
 *
 * Useful when keys are rotated and the caller wants fresh keys
 * on the next FetchJWK call.
 */
export function ClearJWKCache(): void {
  keyCache.clear()
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * fetchJWKSet fetches a JWK Set from the provided URL.
 */
async function fetchJWKSet(url: string): Promise<JWKS> {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(
      `Failed to fetch JWK Set: ${response.status} ${response.statusText}`,
    )
  }

  return response.json() as Promise<JWKS>
}
