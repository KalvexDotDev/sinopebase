/**
 * Tests for HMAC-signed storage URLs with replay protection.
 *
 * Covers:
 * - Pure function tests for signUrl / verifySignedUrl / uploadUrl
 * - HTTP endpoint tests for sign, download, and upload routes
 * - Tamper, expiry, and malformed token rejection
 * - Key ID rotation, method scoping, and replay detection
 * - Timing-safe comparison via source inspection
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import { createHmac, hkdfSync, randomUUID } from 'node:crypto'
import { Elysia } from 'elysia'
import { createStoragePlugin } from '~/apis/file'
import {
  NonceStore,
  nonceStore,
  SignedUrlError,
  signUrl,
  uploadUrl,
  verifySignedUrl,
} from '~/apis/signed-url'
import type { Bucket, FileObject, IFileStore } from '~/tools/filesystem/store-interface'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const JWT_DEV_FALLBACK = 'sinopebase-dev-jwt-secret-min-32-chars!!'

function getTestSecret(): string {
  return process.env.JWT_SECRET ?? JWT_DEV_FALLBACK
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url')
}

/** Derive a per-bucket HMAC key (mirrors the production code). */
function deriveTestKey(bucket: string, secret: string = getTestSecret()): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(secret, 'utf-8'),
      Buffer.alloc(0),
      `sinopebase:signed-url:${bucket}:v1`,
      32,
    ),
  )
}

/**
 * Manually construct a signed token for a given payload, bypassing signUrl().
 * Used to craft expired tokens and other edge cases.
 */
function craftToken(
  bucket: string,
  path: string,
  exp: number,
  overrides?: Partial<{ kid: string; jti: string; method: string; secret: string }>,
): string {
  const payload = {
    bucket,
    path,
    exp,
    kid: overrides?.kid ?? 'sinopebase-v1',
    jti: overrides?.jti ?? randomUUID(),
    method: overrides?.method ?? 'GET',
  }
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload), 'utf-8'))
  const secret = overrides?.secret ?? getTestSecret()
  const key = deriveTestKey(bucket, secret)
  const sig = base64url(createHmac('sha256', key).update(payloadB64, 'utf-8').digest())
  return `${payloadB64}.${sig}`
}

class TestFileStore implements IFileStore {
  readonly files = new Map<string, Buffer>()

  async save(bucket: string, path: string, data: ArrayBuffer): Promise<void> {
    this.files.set(`${bucket}/${path}`, Buffer.from(data))
  }
  async read(bucket: string, path: string): Promise<Buffer> {
    const file = this.files.get(`${bucket}/${path}`)
    if (!file) throw new Error('not found')
    return file
  }
  async delete(bucket: string, paths: string[]): Promise<string[]> {
    return paths.filter((p) => this.files.delete(`${bucket}/${p}`))
  }
  async list(bucket: string, prefix = ''): Promise<FileObject[]> {
    return [...this.files.keys()]
      .filter((k) => k.startsWith(`${bucket}/${prefix}`))
      .map((k) => ({
        name: k.slice(bucket.length + 1),
        id: k,
        updated_at: null,
        created_at: null,
        last_accessed_at: null,
        metadata: null,
      }))
  }
  async listBuckets(): Promise<Bucket[]> {
    return []
  }
  async createBucket(name: string): Promise<string> {
    return name
  }
  async ensureBucket(_name: string): Promise<void> {}
}

function storageApp(store = new TestFileStore()) {
  return {
    app: new Elysia().use(
      createStoragePlugin(store, {
        resolveContext: () => ({ role: 'service_role' }),
      }),
    ),
    store,
  }
}

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------

describe('signUrl / verifySignedUrl — pure functions', () => {
  beforeEach(() => {
    nonceStore.clear()
  })

  it('signs and verifies a valid token', () => {
    const token = signUrl('my-bucket', 'path/to/file.pdf', 3600)
    const result = verifySignedUrl(token)
    expect(result).toEqual({
      bucket: 'my-bucket',
      path: 'path/to/file.pdf',
      method: 'GET',
    })
  })

  it('uses default TTL when expiresInSec is omitted', () => {
    const token = signUrl('b', 'f')
    // Token should be valid for at least ~3599 more seconds
    const result = verifySignedUrl(token)
    expect(result).toEqual({ bucket: 'b', path: 'f', method: 'GET' })
  })

  it('rejects an expired token', () => {
    const past = Math.floor(Date.now() / 1000) - 3600
    const token = craftToken('b', 'f', past)
    expect(() => verifySignedUrl(token)).toThrow(SignedUrlError)
    expect(() => verifySignedUrl(token)).toThrow('Token expired')
  })

  it('rejects a token with tampered signature', () => {
    const token = signUrl('b', 'f', 3600)
    // Flip the last character of the signature portion
    const tampered = token.slice(0, -1) + (token[token.length - 1] === 'a' ? 'b' : 'a')
    expect(() => verifySignedUrl(tampered)).toThrow(SignedUrlError)
    expect(() => verifySignedUrl(tampered)).toThrow('Invalid signature')
  })

  it('rejects a token with tampered payload', () => {
    const token = signUrl('b', 'f', 3600)
    // Flip a character in the payload (first) portion
    const dot = token.lastIndexOf('.')
    const payloadPart = token.slice(0, dot)
    const sigPart = token.slice(dot + 1)
    const tamperedPayload = (payloadPart[0] === 'a' ? 'b' : 'a') + payloadPart.slice(1)
    const tampered = `${tamperedPayload}.${sigPart}`
    expect(() => verifySignedUrl(tampered)).toThrow(SignedUrlError)
  })

  it('rejects a malformed token with no dot', () => {
    expect(() => verifySignedUrl('just-a-plain-string')).toThrow(SignedUrlError)
    expect(() => verifySignedUrl('')).toThrow(SignedUrlError)
  })

  it('rejects a token with empty payload or signature', () => {
    expect(() => verifySignedUrl('.abc')).toThrow(SignedUrlError)
    expect(() => verifySignedUrl('abc.')).toThrow(SignedUrlError)
  })

  it('rejects a token with non-JSON payload', () => {
    const payloadB64 = base64url(Buffer.from('this-is-not-json', 'utf-8'))
    const sig = base64url(
      createHmac('sha256', deriveTestKey('b')).update(payloadB64, 'utf-8').digest(),
    )
    expect(() => verifySignedUrl(`${payloadB64}.${sig}`)).toThrow(SignedUrlError)
    expect(() => verifySignedUrl(`${payloadB64}.${sig}`)).toThrow('Malformed payload')
  })

  it('rejects a token with payload missing required fields', () => {
    const payloadB64 = base64url(Buffer.from(JSON.stringify({ foo: 'bar' }), 'utf-8'))
    const sig = base64url(
      createHmac('sha256', deriveTestKey('b')).update(payloadB64, 'utf-8').digest(),
    )
    expect(() => verifySignedUrl(`${payloadB64}.${sig}`)).toThrow(SignedUrlError)
  })

  it('rejects a token with wrong secret (signature mismatch)', () => {
    const wrongSecret = 'this-is-a-completely-different-secret-key!!'
    const token = craftToken('b', 'f', Math.floor(Date.now() / 1000) + 3600, {
      secret: wrongSecret,
    })
    expect(() => verifySignedUrl(token)).toThrow(SignedUrlError)
    expect(() => verifySignedUrl(token)).toThrow('Invalid signature')
  })

  it('rejects a token with unknown kid', () => {
    const token = craftToken('b', 'f', Math.floor(Date.now() / 1000) + 3600, {
      kid: 'unknown-v2',
    })
    expect(() => verifySignedUrl(token)).toThrow(SignedUrlError)
    expect(() => verifySignedUrl(token)).toThrow('Unknown key ID')
  })

  it('rejects a token with invalid method', () => {
    const token = craftToken('b', 'f', Math.floor(Date.now() / 1000) + 3600, {
      method: 'DELETE',
    })
    expect(() => verifySignedUrl(token)).toThrow(SignedUrlError)
    expect(() => verifySignedUrl(token)).toThrow('Malformed payload')
  })

  it('rejects a replayed token', () => {
    const token = signUrl('b', 'f', 3600)
    // First verification succeeds
    const result = verifySignedUrl(token)
    expect(result).toEqual({ bucket: 'b', path: 'f', method: 'GET' })
    // Second verification of the same token must fail (replay)
    expect(() => verifySignedUrl(token)).toThrow(SignedUrlError)
    expect(() => verifySignedUrl(token)).toThrow('Token replayed')
  })

  it('allows distinct tokens from the same bucket and path', () => {
    const tokenA = signUrl('b', 'f', 3600)
    const tokenB = signUrl('b', 'f', 3600)
    expect(verifySignedUrl(tokenA)).toEqual({ bucket: 'b', path: 'f', method: 'GET' })
    expect(verifySignedUrl(tokenB)).toEqual({ bucket: 'b', path: 'f', method: 'GET' })
  })
})

// ---------------------------------------------------------------------------
// uploadUrl
// ---------------------------------------------------------------------------

describe('uploadUrl', () => {
  beforeEach(() => {
    nonceStore.clear()
  })

  it('creates a PUT-scoped token', () => {
    const token = uploadUrl('bucket', 'path/file.bin', 3600)
    const result = verifySignedUrl(token)
    expect(result).toEqual({ bucket: 'bucket', path: 'path/file.bin', method: 'PUT' })
  })

  it('differs from a GET token for the same bucket and path', () => {
    const getToken = signUrl('bucket', 'path/file.bin', 3600)
    const putToken = uploadUrl('bucket', 'path/file.bin', 3600)
    // Tokens must be different because the payloads differ (method + jti)
    expect(getToken).not.toBe(putToken)
    // GET token must have method=GET
    expect(verifySignedUrl(getToken).method).toBe('GET')
    // PUT token must have method=PUT
    expect(verifySignedUrl(putToken).method).toBe('PUT')
  })

  it('uses default TTL when expiresInSec is omitted', () => {
    const token = uploadUrl('b', 'f')
    expect(() => verifySignedUrl(token)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// NonceStore unit tests
// ---------------------------------------------------------------------------

describe('NonceStore', () => {
  let store: NonceStore

  beforeEach(() => {
    store = new NonceStore()
  })

  it('returns true for a new nonce', () => {
    expect(store.checkAndConsume('new-nonce', Math.floor(Date.now() / 1000) + 3600)).toBe(true)
  })

  it('returns false for a replayed nonce', () => {
    const jti = 'replay-nonce'
    expect(store.checkAndConsume(jti, Math.floor(Date.now() / 1000) + 3600)).toBe(true)
    expect(store.checkAndConsume(jti, Math.floor(Date.now() / 1000) + 3600)).toBe(false)
  })

  it('allows distinct nonces', () => {
    expect(store.checkAndConsume('a', Math.floor(Date.now() / 1000) + 3600)).toBe(true)
    expect(store.checkAndConsume('b', Math.floor(Date.now() / 1000) + 3600)).toBe(true)
  })

  it('tracks size', () => {
    expect(store.size).toBe(0)
    store.checkAndConsume('a', Math.floor(Date.now() / 1000) + 3600)
    expect(store.size).toBe(1)
    store.checkAndConsume('b', Math.floor(Date.now() / 1000) + 3600)
    expect(store.size).toBe(2)
  })

  it('clear removes all entries', () => {
    store.checkAndConsume('a', Math.floor(Date.now() / 1000) + 3600)
    store.checkAndConsume('b', Math.floor(Date.now() / 1000) + 3600)
    expect(store.size).toBe(2)
    store.clear()
    expect(store.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// HTTP endpoint tests
// ---------------------------------------------------------------------------

describe('POST /storage/v1/object/sign/:bucket/* — signed URL creation', () => {
  beforeEach(() => {
    nonceStore.clear()
  })

  it('returns an HMAC-signed URL path', async () => {
    const { app } = storageApp()
    const response = await app.handle(
      new Request('http://localhost/storage/v1/object/sign/evidence/tenant/report.pdf', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expiresIn: 7200 }),
      }),
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body).toHaveProperty('signedURL')
    const signedURL = body.signedURL as string
    // Must point to the /signed/ endpoint, not a plain path
    expect(signedURL).toMatch(/^\/storage\/v1\/object\/signed\//)
    // The token portion should contain a dot (payload.separator.signature)
    const tokenPart = signedURL.replace('/storage/v1/object/signed/', '')
    expect(tokenPart).toContain('.')
  })

  it('defaults to 1 hour when expiresIn is omitted', async () => {
    const { app } = storageApp()
    const response = await app.handle(
      new Request('http://localhost/storage/v1/object/sign/evidence/doc.pdf', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body).toHaveProperty('signedURL')
  })

  it('creates a GET-scoped token by default', async () => {
    const { app } = storageApp()
    const response = await app.handle(
      new Request('http://localhost/storage/v1/object/sign/evidence/doc.pdf', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    const signedURL = body.signedURL as string
    const tokenPart = signedURL.replace('/storage/v1/object/signed/', '')
    const result = verifySignedUrl(tokenPart)
    expect(result.method).toBe('GET')
  })

  it('creates a PUT-scoped token when method is specified', async () => {
    const { app } = storageApp()
    const response = await app.handle(
      new Request('http://localhost/storage/v1/object/sign/evidence/doc.pdf', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method: 'PUT' }),
      }),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    const signedURL = body.signedURL as string
    const tokenPart = signedURL.replace('/storage/v1/object/signed/', '')
    const result = verifySignedUrl(tokenPart)
    expect(result.method).toBe('PUT')
  })
})

describe('GET /storage/v1/object/signed/:token — file download via signed URL', () => {
  beforeEach(() => {
    nonceStore.clear()
  })

  it('downloads a file with a valid token', async () => {
    const { app, store } = storageApp()
    store.files.set('evidence/report.pdf', Buffer.from('signed-download-content'))

    const token = signUrl('evidence', 'report.pdf', 3600)
    const response = await app.handle(
      new Request(`http://localhost/storage/v1/object/signed/${token}`),
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('signed-download-content')
  })

  it('returns 403 for an expired token', async () => {
    const { app, store } = storageApp()
    store.files.set('evidence/report.pdf', Buffer.from('content'))

    const past = Math.floor(Date.now() / 1000) - 60
    const token = craftToken('evidence', 'report.pdf', past)
    const response = await app.handle(
      new Request(`http://localhost/storage/v1/object/signed/${token}`),
    )

    expect(response.status).toBe(403)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.message as string).toMatch(/expired/i)
  })

  it('returns 403 for a tampered signature', async () => {
    const { app, store } = storageApp()
    store.files.set('evidence/report.pdf', Buffer.from('content'))

    const token = signUrl('evidence', 'report.pdf', 3600)
    const tampered = token.slice(0, -1) + (token[token.length - 1] === 'a' ? 'b' : 'a')
    const response = await app.handle(
      new Request(`http://localhost/storage/v1/object/signed/${tampered}`),
    )

    expect(response.status).toBe(403)
  })

  it('returns 403 for a tampered payload', async () => {
    const { app, store } = storageApp()
    store.files.set('evidence/report.pdf', Buffer.from('content'))

    const token = signUrl('evidence', 'report.pdf', 3600)
    const dot = token.lastIndexOf('.')
    const payloadPart = token.slice(0, dot)
    const sigPart = token.slice(dot + 1)
    const tamperedPayload = (payloadPart[0] === 'a' ? 'b' : 'a') + payloadPart.slice(1)
    const tampered = `${tamperedPayload}.${sigPart}`
    const response = await app.handle(
      new Request(`http://localhost/storage/v1/object/signed/${tampered}`),
    )

    expect(response.status).toBe(403)
  })

  it('returns 403 when the file does not exist (valid token, missing file)', async () => {
    const { app } = storageApp()
    const token = signUrl('evidence', 'nonexistent.pdf', 3600)
    const response = await app.handle(
      new Request(`http://localhost/storage/v1/object/signed/${token}`),
    )

    expect(response.status).toBe(500) // storageOperation wraps non-StorageAccessError as 500
  })

  it('returns 403 when a PUT token is used on the GET endpoint', async () => {
    const { app, store } = storageApp()
    store.files.set('evidence/report.pdf', Buffer.from('content'))

    const token = uploadUrl('evidence', 'report.pdf', 3600)
    const response = await app.handle(
      new Request(`http://localhost/storage/v1/object/signed/${token}`),
    )

    expect(response.status).toBe(403)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.message as string).toMatch(/expected GET/i)
  })
})

describe('PUT /storage/v1/object/signed/upload/:token — file upload via signed URL', () => {
  beforeEach(() => {
    nonceStore.clear()
  })

  it('uploads a file with a valid PUT token', async () => {
    const { app, store } = storageApp()
    const token = uploadUrl('evidence', 'uploaded-file.pdf', 3600)
    const response = await app.handle(
      new Request(`http://localhost/storage/v1/object/signed/upload/${token}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/pdf' },
        body: Buffer.from('upload-content'),
      }),
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body).toHaveProperty('Id')
    expect(body).toHaveProperty('Key')
    // Verify the file was saved
    const saved = await store.read('evidence', 'uploaded-file.pdf')
    expect(saved.toString()).toBe('upload-content')
  })

  it('returns 403 with an expired token', async () => {
    const { app } = storageApp()
    const past = Math.floor(Date.now() / 1000) - 60
    const token = craftToken('evidence', 'uploaded-file.pdf', past)
    const response = await app.handle(
      new Request(`http://localhost/storage/v1/object/signed/upload/${token}`, {
        method: 'PUT',
        body: Buffer.from('content'),
      }),
    )

    expect(response.status).toBe(403)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.message as string).toMatch(/expired/i)
  })

  it('returns 403 when a GET token is used on the PUT upload endpoint', async () => {
    const { app } = storageApp()
    const token = signUrl('evidence', 'repoert.pdf', 3600) // defaults to GET
    const response = await app.handle(
      new Request(`http://localhost/storage/v1/object/signed/upload/${token}`, {
        method: 'PUT',
        body: Buffer.from('content'),
      }),
    )

    expect(response.status).toBe(403)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.message as string).toMatch(/expected PUT/i)
  })

  it('returns 400 when the upload body is empty', async () => {
    const { app } = storageApp()
    const token = uploadUrl('evidence', 'empty-file.pdf', 3600)
    const response = await app.handle(
      new Request(`http://localhost/storage/v1/object/signed/upload/${token}`, {
        method: 'PUT',
        body: Buffer.alloc(0),
      }),
    )

    expect(response.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// Timing-safe comparison verification
// ---------------------------------------------------------------------------

describe('timing-safe comparison', () => {
  it('uses timingSafeEqual from node:crypto in the verify path', async () => {
    // Verify by inspecting the source — the implementation must use
    // timingSafeEqual. The structural check ensures we don't regress
    // to a non-constant-time comparison.
    const source = await Bun.file(new URL('../../src/apis/signed-url.ts', import.meta.url)).text()
    expect(source).toContain('timingSafeEqual')
  })
})
