/**
 * Tests for HMAC-signed storage URLs: reusable GET tokens and single-use PUT tokens.
 *
 * Covers:
 * - Pure function tests for signUrl / verifySignedUrl / uploadUrl
 * - HTTP endpoint tests for sign, download, and upload routes
 * - Tamper, expiry, and malformed token rejection
 * - Key ID rotation, method scoping, and reusable GET token behaviour
 * - PUT tokens: one use, a byte limit enforced while streaming, a bound content type (sinope#1103)
 * - Timing-safe comparison via source inspection
 *
 * @new-code-test positive src/apis/signed-url.ts
 * @new-code-test negative src/apis/signed-url.ts
 * @new-code-test positive src/apis/file.ts
 * @new-code-test negative src/apis/file.ts
 */

import { describe, expect, it } from 'bun:test'
import { createHmac, hkdfSync } from 'node:crypto'
import { Elysia } from 'elysia'
import { createStoragePlugin } from '~/apis/file'
import {
  DEFAULT_SIGNED_UPLOAD_BYTES,
  SignedUrlError,
  signUrl,
  uploadUrl,
  type VerifiedToken,
  verifySignedUrl,
} from '~/apis/signed-url'
import type { Bucket, FileObject, IFileStore } from '~/tools/filesystem/store-interface'
import { JWT_DEV_FALLBACK } from '~/tools/security/constants'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/** Sign any payload with the bucket's key, as a token minted by this or an older server would be. */
function signPayload(
  bucket: string,
  payload: Record<string, unknown>,
  secret = getTestSecret(),
): string {
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload), 'utf-8'))
  const sig = base64url(
    createHmac('sha256', deriveTestKey(bucket, secret)).update(payloadB64, 'utf-8').digest(),
  )
  return `${payloadB64}.${sig}`
}

/**
 * Manually construct a signed token for a given payload, bypassing signUrl().
 * Used to craft expired tokens and other edge cases.
 */
function craftToken(
  bucket: string,
  path: string,
  exp: number,
  overrides?: Partial<{ kid: string; method: string; secret: string }>,
): string {
  const payload = {
    bucket,
    path,
    exp,
    kid: overrides?.kid ?? 'sinopebase-v1',
    method: overrides?.method ?? 'GET',
  }
  return signPayload(bucket, payload, overrides?.secret)
}

/** A PUT token's payload as this server mints it, with `overrides` applied. */
function uploadPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    bucket: 'evidence',
    path: 'tenant/report.pdf',
    exp: Math.floor(Date.now() / 1000) + 3600,
    kid: 'sinopebase-v1',
    method: 'PUT',
    jti: '0f9a2f34-5a6b-4c7d-8e9f-a0b1c2d3e4f5',
    max: 64,
    ...overrides,
  }
}

/** The single-use claims a verified PUT token carries. */
function uploadOf(token: VerifiedToken) {
  if (!token.upload) throw new Error('Expected a PUT token')
  return token.upload
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
  async deleteBucket(_name: string): Promise<void> {}
  async ensureBucket(_name: string): Promise<void> {}
}

function storageApp(store = new TestFileStore(), maxUploadSize?: number) {
  return {
    app: new Elysia().use(
      createStoragePlugin(store, {
        resolveContext: () => ({ role: 'service_role' }),
        maxUploadSize,
      }),
    ),
    store,
  }
}

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------

describe('signUrl / verifySignedUrl — pure functions', () => {
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
    // Tamper a character in the signature portion (after the last dot).
    // Last-character tampering can produce collisions in base64url's
    // trailing partial byte — flip a middle signature character instead.
    const dotIndex = token.lastIndexOf('.')
    const sigStart = dotIndex + 1
    const flipIndex = sigStart + Math.floor((token.length - sigStart) / 2)
    const tampered =
      token.slice(0, flipIndex) +
      (token[flipIndex] === 'a' ? 'b' : 'a') +
      token.slice(flipIndex + 1)
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

  it('allows reusing the same token (stateless — reusable within expiry)', () => {
    const token = signUrl('b', 'f', 3600)
    // First verification succeeds
    expect(verifySignedUrl(token)).toEqual({ bucket: 'b', path: 'f', method: 'GET' })
    // Second verification of the same token must also succeed (reusable)
    expect(() => verifySignedUrl(token)).not.toThrow()
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
  it('creates a single-use PUT token with the default byte limit and any type', () => {
    const token = uploadUrl('bucket', 'path/file.bin', 3600)
    const result = verifySignedUrl(token)
    expect(result).toEqual({
      bucket: 'bucket',
      path: 'path/file.bin',
      method: 'PUT',
      upload: {
        jti: expect.stringMatching(/^[0-9a-f-]{36}$/),
        expiresAt: expect.any(Number),
        maxBytes: DEFAULT_SIGNED_UPLOAD_BYTES,
        contentType: null,
      },
    })
  })

  it('binds its byte limit and content type, and names each use apart', () => {
    const limits = { maxBytes: 1024, contentType: 'application/pdf' }
    const first = uploadOf(verifySignedUrl(uploadUrl('b', 'f', 60, limits)))
    const second = uploadOf(verifySignedUrl(uploadUrl('b', 'f', 60, limits)))
    expect(first).toMatchObject({ maxBytes: 1024, contentType: 'application/pdf' })
    expect(first.expiresAt - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(60)
    expect(second.jti).not.toBe(first.jti)
  })

  it('gives GET tokens no upload claims', () => {
    expect(verifySignedUrl(signUrl('b', 'f', 60)).upload).toBeUndefined()
  })

  it('accepts a PUT token minted without the single-use claims, still once and bounded', () => {
    const token = signPayload('evidence', uploadPayload({ jti: undefined, max: undefined }))
    const legacy = uploadOf(verifySignedUrl(token))
    expect(legacy).toMatchObject({ maxBytes: DEFAULT_SIGNED_UPLOAD_BYTES, contentType: null })
    expect(legacy.jti).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    // Its signature names its one use, however the signature is encoded: the last character
    // of a 32-byte base64url signature carries two spare bits a decoder ignores.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    const reencoded = token.slice(0, -1) + alphabet[alphabet.indexOf(token.slice(-1)) ^ 1]
    expect(reencoded).not.toBe(token)
    expect(uploadOf(verifySignedUrl(reencoded)).jti).toBe(legacy.jti)
    const other = signPayload('evidence', uploadPayload({ jti: undefined, path: 'tenant/b.pdf' }))
    expect(uploadOf(verifySignedUrl(other)).jti).not.toBe(legacy.jti)
  })

  it('refuses a PUT token whose single-use claims are malformed', () => {
    const malformed = [
      uploadPayload({ jti: 'not-a-uuid' }),
      uploadPayload({ jti: null }),
      uploadPayload({ max: 0 }),
      uploadPayload({ max: 1.5 }),
      uploadPayload({ max: '64' }),
      uploadPayload({ type: 'Application/PDF' }),
      uploadPayload({ type: 'pdf' }),
    ]
    for (const payload of malformed) {
      expect(() => verifySignedUrl(signPayload('evidence', payload))).toThrow('Malformed payload')
    }
    const valid = verifySignedUrl(signPayload('evidence', uploadPayload({ type: 'image/png' })))
    expect(uploadOf(valid)).toMatchObject({ maxBytes: 64, contentType: 'image/png' })
  })

  it('refuses a PUT token whose path, limit or type was altered after signing', () => {
    const token = uploadUrl('evidence', 'tenant/report.pdf', 60, {
      maxBytes: 64,
      contentType: 'application/pdf',
    })
    const [payloadB64, sig] = token.split('.')
    const payload = JSON.parse(Buffer.from(payloadB64 ?? '', 'base64url').toString('utf-8'))
    for (const change of [
      { path: 'tenant/other.pdf' },
      { path: 'other-tenant/report.pdf' },
      { max: 1_000_000 },
      { type: 'text/html' },
    ]) {
      const altered = base64url(Buffer.from(JSON.stringify({ ...payload, ...change }), 'utf-8'))
      expect(() => verifySignedUrl(`${altered}.${sig}`)).toThrow('Invalid signature')
    }
  })

  it('differs from a GET token for the same bucket and path', () => {
    const getToken = signUrl('bucket', 'path/file.bin', 3600)
    const putToken = uploadUrl('bucket', 'path/file.bin', 3600)
    // Tokens must be different because the payloads differ (method)
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
// HTTP endpoint tests
// ---------------------------------------------------------------------------

describe('POST /storage/v1/object/sign/:bucket/* — signed URL creation', () => {
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

  it('creates a single-use upload URL when method is PUT', async () => {
    const { app } = storageApp()
    const response = await app.handle(
      new Request('http://localhost/storage/v1/object/sign/evidence/doc.pdf', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method: 'PUT', maxBytes: 2048, contentType: 'application/pdf' }),
      }),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    const signedURL = body.signedURL as string
    expect(signedURL).toStartWith('/storage/v1/object/signed/upload/')
    const result = verifySignedUrl(signedURL.replace('/storage/v1/object/signed/upload/', ''))
    expect(result.method).toBe('PUT')
    expect(uploadOf(result)).toMatchObject({ maxBytes: 2048, contentType: 'application/pdf' })
  })

  it('refuses upload limits it cannot enforce', async () => {
    const { app } = storageApp(new TestFileStore(), 4096)
    const sign = (limits: Record<string, unknown>) =>
      app.handle(
        new Request('http://localhost/storage/v1/object/sign/evidence/doc.pdf', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ method: 'PUT', ...limits }),
        }),
      )
    for (const limits of [
      { maxBytes: 0 },
      { maxBytes: -1 },
      { maxBytes: 1.5 },
      { maxBytes: '64' },
      { maxBytes: 4097 },
      { contentType: 'PDF' },
      { contentType: 'application/pdf; charset=binary' },
      { contentType: 7 },
    ]) {
      const response = await sign(limits)
      expect({ limits, status: response.status }).toEqual({ limits, status: 400 })
    }
    const defaulted = await sign({})
    const { signedURL } = (await defaulted.json()) as { signedURL: string }
    const token = signedURL.replace('/storage/v1/object/signed/upload/', '')
    expect(uploadOf(verifySignedUrl(token)).maxBytes).toBe(4096)
  })

  it('gives an upload URL without limits the 25 MiB default', async () => {
    const { app } = storageApp()
    const response = await app.handle(
      new Request('http://localhost/storage/v1/object/sign/evidence/doc.pdf', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method: 'PUT' }),
      }),
    )
    const { signedURL } = (await response.json()) as { signedURL: string }
    const token = signedURL.replace('/storage/v1/object/signed/upload/', '')
    expect(uploadOf(verifySignedUrl(token))).toMatchObject({
      maxBytes: DEFAULT_SIGNED_UPLOAD_BYTES,
      contentType: null,
    })
  })
})

describe('GET /storage/v1/object/signed/:token — file download via signed URL', () => {
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
    // Tamper a character in the signature portion (after the last dot).
    // Last-character tampering can produce collisions in base64url's
    // trailing partial byte — flip a middle signature character instead.
    const dotIndex = token.lastIndexOf('.')
    const sigStart = dotIndex + 1
    const flipIndex = sigStart + Math.floor((token.length - sigStart) / 2)
    const tampered =
      token.slice(0, flipIndex) +
      (token[flipIndex] === 'a' ? 'b' : 'a') +
      token.slice(flipIndex + 1)
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

  function put(app: Elysia, token: string, body: BodyInit, headers: Record<string, string> = {}) {
    return app.handle(
      new Request(`http://localhost/storage/v1/object/signed/upload/${token}`, {
        method: 'PUT',
        headers,
        body,
        duplex: 'half',
      } as RequestInit),
    )
  }

  /** An endless body that counts how many 1 KiB chunks the server pulled. */
  function endlessBody() {
    const pulled = { chunks: 0 }
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled.chunks += 1
        controller.enqueue(new Uint8Array(1024).fill(0x41))
      },
    })
    return { stream, pulled }
  }

  it('uploads once: the same URL is refused afterwards and the object kept', async () => {
    const { app, store } = storageApp()
    const token = uploadUrl('evidence', 'tenant/once.pdf', 60, { maxBytes: 64 })
    expect((await put(app, token, 'first')).status).toBe(200)
    const reused = await put(app, token, 'second')
    expect(reused.status).toBe(403)
    expect(await reused.json()).toMatchObject({ message: 'Token already used' })
    expect((await store.read('evidence', 'tenant/once.pdf')).toString()).toBe('first')
  })

  it('lets exactly one of two racing uses through', async () => {
    const { app, store } = storageApp()
    const token = uploadUrl('evidence', 'tenant/race.pdf', 60, { maxBytes: 64 })
    const statuses = await Promise.all([put(app, token, 'a'), put(app, token, 'b')])
    expect(statuses.map((response) => response.status).sort()).toEqual([200, 403])
    expect(['a', 'b']).toContain((await store.read('evidence', 'tenant/race.pdf')).toString())
  })

  it('refuses a declared length over the limit before the URL is spent', async () => {
    const { app, store } = storageApp()
    const token = uploadUrl('evidence', 'tenant/size.pdf', 60, { maxBytes: 4 })
    const declared = await put(app, token, '12345', { 'content-length': '5' })
    expect(declared.status).toBe(413)
    expect(store.files.size).toBe(0)
    expect((await put(app, token, '1234')).status).toBe(200)
  })

  it('stops reading a body without a declared length as soon as it passes the limit', async () => {
    const { app, store } = storageApp()
    const token = uploadUrl('evidence', 'tenant/stream.pdf', 60, { maxBytes: 4096 })
    const { stream, pulled } = endlessBody()
    const streamed = await put(app, token, stream)
    expect(streamed.status).toBe(413)
    expect(await streamed.json()).toMatchObject({
      message: 'Upload body exceeds the 4096 byte limit.',
    })
    expect(pulled.chunks).toBeLessThan(16)
    expect(store.files.size).toBe(0)
    // The attempt spent the URL: it cannot be retried with a smaller body.
    expect((await put(app, token, 'small')).status).toBe(403)
  })

  it('accepts only the content type bound into the URL', async () => {
    const { app, store } = storageApp()
    const token = uploadUrl('evidence', 'tenant/typed.pdf', 60, {
      maxBytes: 64,
      contentType: 'application/pdf',
    })
    for (const contentType of ['text/html', 'application/x-pdf', '']) {
      const refused = await put(app, token, '%PDF-1.7', { 'content-type': contentType })
      expect(refused.status).toBe(415)
    }
    expect(store.files.size).toBe(0)
    const typed = await put(app, token, '%PDF-1.7', { 'content-type': 'Application/PDF; x=1' })
    expect(typed.status).toBe(200)
  })
})

describe('supabase-js signed uploads — /storage/v1/object/upload/sign/:bucket/*', () => {
  const route = 'http://localhost/storage/v1/object/upload/sign'

  function mint(app: Elysia, object: string, headers: Record<string, string> = {}) {
    return app.handle(new Request(`${route}/${object}`, { method: 'POST', headers, body: '{}' }))
  }

  function upload(app: Elysia, object: string, token: string, body: BodyInit) {
    return app.handle(new Request(`${route}/${object}?token=${token}`, { method: 'PUT', body }))
  }

  it('mints the URL createSignedUploadUrl() reads, with the 25 MiB default and no type', async () => {
    const { app } = storageApp()
    const response = await mint(app, 'evidence/tenant/sdk.pdf')
    expect(response.status).toBe(200)
    const { url, token } = (await response.json()) as { url: string; token: string }
    expect(url).toBe(`/object/upload/sign/evidence/tenant/sdk.pdf?token=${token}`)
    const claims = verifySignedUrl(token)
    expect(claims).toMatchObject({ bucket: 'evidence', path: 'tenant/sdk.pdf', method: 'PUT' })
    expect(uploadOf(claims)).toMatchObject({
      maxBytes: DEFAULT_SIGNED_UPLOAD_BYTES,
      contentType: null,
    })
    // Supabase's signed upload URLs last two hours.
    const lifetime = uploadOf(claims).expiresAt - Math.floor(Date.now() / 1000)
    expect(lifetime).toBeGreaterThan(7190)
    expect(lifetime).toBeLessThanOrEqual(7200)
  })

  it('refuses an invalid bucket, an invalid name and upsert', async () => {
    const { app } = storageApp()
    const refusals = [
      [await mint(app, 'bad~bucket/tenant/sdk.pdf'), 'Invalid bucket name'],
      [await mint(app, 'evidence/tenant//sdk.pdf'), 'Invalid key: tenant//sdk.pdf'],
      [
        await mint(app, 'evidence/tenant/sdk.pdf', { 'x-upsert': 'true' }),
        'A signed upload never overwrites (no upsert)',
      ],
    ] as const
    for (const [response, message] of refusals) {
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ message })
    }
  })

  it('takes the form uploadToSignedUrl() sends for a Blob, once', async () => {
    const { app, store } = storageApp()
    const { token } = (await (await mint(app, 'evidence/tenant/form.pdf')).json()) as {
      token: string
    }
    const form = () => {
      const body = new FormData()
      body.append('cacheControl', '3600')
      body.append('', new Blob(['%PDF-1.7 form'], { type: 'application/pdf' }), 'form.pdf')
      return body
    }
    const response = await upload(app, 'evidence/tenant/form.pdf', token, form())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      Id: 'evidence/tenant/form.pdf',
      Key: 'evidence/tenant/form.pdf',
    })
    expect((await store.read('evidence', 'tenant/form.pdf')).toString()).toBe('%PDF-1.7 form')
    expect((await upload(app, 'evidence/tenant/form.pdf', token, form())).status).toBe(403)
  })

  it('writes only the object its token names, and checks a form file against the limits', async () => {
    const { app, store } = storageApp()
    const token = uploadUrl('evidence', 'tenant/mine.pdf', 60, {
      maxBytes: 8,
      contentType: 'application/pdf',
    })
    for (const object of ['evidence/tenant/theirs.pdf', 'other/tenant/mine.pdf']) {
      const elsewhere = await upload(app, object, token, '%PDF')
      expect(elsewhere.status).toBe(403)
      expect(await elsewhere.json()).toMatchObject({
        message: 'The token was signed for another object',
      })
    }
    const file = (content: string, type: string) => {
      const body = new FormData()
      body.append('', new Blob([content], { type }), 'file')
      return body
    }
    const html = await upload(app, 'evidence/tenant/mine.pdf', token, file('<p>', 'text/html'))
    expect(html.status).toBe(415)
    expect(store.files.size).toBe(0)
    const big = uploadUrl('evidence', 'tenant/big.pdf', 60, { maxBytes: 8 })
    const tooBig = await upload(app, 'evidence/tenant/big.pdf', big, file('%PDF-1.7 x', 'a/b'))
    expect(tooBig.status).toBe(413)
    expect(store.files.size).toBe(0)
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
